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

    /** Download a task document via a Cloudinary signed private-download URL */
    @Get('documents/:docId/download')
    async downloadDocument(
        @Param('docId', ParseIntPipe) docId: number,
        @Res() res: ExpressResponse,
    ) {
        const doc = await this.docsService.getDocument(docId);
        if (!doc.url || !doc.cloudinaryPublicId) {
            throw new BadRequestException('Document URL not available');
        }

        // Must configure credentials here because this runs per-request on Railway
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
        });

        // Derive resource_type from the stored URL — more reliable than mimeType
        // because Cloudinary auto-classifies on upload (e.g. PDF may land as 'image')
        let resourceType = 'raw';
        if (doc.url.includes('/image/upload/')) resourceType = 'image';
        else if (doc.url.includes('/video/upload/')) resourceType = 'video';

        // For non-raw resources Cloudinary needs the format (file extension) separately
        let format = '';
        if (resourceType !== 'raw') {
            // Extract extension from stored URL path, e.g. ".pdf" → "pdf"
            const lastSegment = doc.url.split('?')[0].split('/').pop() ?? '';
            const dotIdx = lastSegment.lastIndexOf('.');
            if (dotIdx !== -1) format = lastSegment.slice(dotIdx + 1);
        }

        // private_download_url generates a time-limited signed URL routed through
        // api.cloudinary.com (not the CDN), so it works even when the Cloudinary
        // account has CDN access restrictions or requires signed delivery.
        const signedUrl = (cloudinary.utils as any).private_download_url(
            doc.cloudinaryPublicId,
            format,
            {
                resource_type: resourceType,
                attachment: doc.originalName ?? 'document',
                expires_at: Math.floor(Date.now() / 1000) + 300, // 5 min
            },
        );

        return res.redirect(signedUrl);
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
