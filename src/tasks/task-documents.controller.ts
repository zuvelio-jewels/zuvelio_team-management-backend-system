import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    ParseIntPipe,
    Request,
    Res,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { v2 as cloudinary } from 'cloudinary';
import type { Response as ExpressResponse } from 'express';
import { TaskDocumentsService } from './task-documents.service';

function getCloudinaryStorage() {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    return new CloudinaryStorage({
        cloudinary,
        params: {
            folder: 'zuvelio-task-documents',
            resource_type: 'auto',
        } as any,
    });
}

const ALLOWED_MIME = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

@Controller('tasks')
export class TaskDocumentsController {
    constructor(private docsService: TaskDocumentsService) { }

    private sanitizeDownloadName(name: string): string {
        return (name || 'document').replace(/[\\/:*?"<>|]+/g, '_');
    }

    private buildContentDisposition(name: string): string {
        const fileName = this.sanitizeDownloadName(name);
        return `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    }

    /** Upload a document to a task */
    @Post(':taskId/documents')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: getCloudinaryStorage(),
            limits: { fileSize: MAX_FILE_SIZE },
            fileFilter: (_req, file, cb) => {
                if (!ALLOWED_MIME.includes(file.mimetype)) {
                    return cb(
                        new BadRequestException(
                            'Unsupported file type. Allowed: images, PDF, Word, Excel, TXT',
                        ),
                        false,
                    );
                }
                cb(null, true);
            },
        }),
    )
    uploadDocument(
        @Param('taskId', ParseIntPipe) taskId: number,
        @UploadedFile() file: Express.Multer.File,
        @Request() req: any,
    ) {
        if (!file) throw new BadRequestException('No file uploaded');
        return this.docsService.create(taskId, file, req.user.id);
    }

    /** List all documents for a task */
    @Get(':taskId/documents')
    listDocuments(@Param('taskId', ParseIntPipe) taskId: number) {
        return this.docsService.findAllByTask(taskId);
    }

    /** Proxy the stored document and force the original download filename */
    @Get('documents/:docId/download')
    async downloadDocument(
        @Param('docId', ParseIntPipe) docId: number,
        @Res() res: ExpressResponse,
    ) {
        const doc = await this.docsService.getDocument(docId);
        if (!doc.url) {
            throw new BadRequestException('Document URL not available');
        }

        const upstream = await fetch(doc.url);
        if (!upstream.ok) {
            throw new BadRequestException('Unable to fetch document from storage');
        }

        const contentType = upstream.headers.get('content-type') || doc.mimeType || 'application/octet-stream';
        const buffer = Buffer.from(await upstream.arrayBuffer());

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length.toString());
        res.setHeader('Content-Disposition', this.buildContentDisposition(doc.originalName || 'document'));

        return res.send(buffer);
    }

    /** Delete a document */
    @Delete('documents/:docId')
    removeDocument(
        @Param('docId', ParseIntPipe) docId: number,
        @Request() req: any,
    ) {
        return this.docsService.remove(docId, req.user.id, req.user.role);
    }
}
