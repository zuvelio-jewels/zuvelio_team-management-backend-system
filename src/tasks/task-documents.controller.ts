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

    /** Download a task document — streams the file from Cloudinary via a signed URL */
    @Get('documents/:docId/download')
    async downloadDocument(
        @Param('docId', ParseIntPipe) docId: number,
        @Res() res: ExpressResponse,
    ) {
        const doc = await this.docsService.getDocument(docId);
        if (!doc.url || !doc.cloudinaryPublicId) {
            throw new BadRequestException('Document URL not available');
        }

        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
        });

        // Derive resource_type from the stored Cloudinary URL
        // (more reliable than mimeType since Cloudinary auto-classifies on upload)
        let resourceType = 'raw';
        if (doc.url.includes('/image/upload/')) resourceType = 'image';
        else if (doc.url.includes('/video/upload/')) resourceType = 'video';

        // For image/video, extract the format extension from the stored URL
        let format: string | undefined;
        if (resourceType !== 'raw') {
            const lastSegment = doc.url.split('?')[0].split('/').pop() ?? '';
            const dotIdx = lastSegment.lastIndexOf('.');
            if (dotIdx !== -1) format = lastSegment.slice(dotIdx + 1);
        }

        // Generate a signed CDN delivery URL.
        // sign_url:true adds an HMAC signature accepted by Cloudinary CDN even when
        // the account has "Require signed URLs" restriction enabled.
        // private_download_url is for type:'private' resources — ours are type:'upload'.
        const signedUrl = cloudinary.url(doc.cloudinaryPublicId, {
            secure: true,
            sign_url: true,
            resource_type: resourceType,
            type: 'upload',
            ...(format ? { format } : {}),
        });

        // Fetch the signed URL server-side (Railway → Cloudinary CDN).
        // This means the browser never touches Cloudinary at all — no CORS, no auth issues.
        const upstream = await fetch(signedUrl);
        if (!upstream.ok) {
            throw new BadRequestException(`Storage error: ${upstream.status}`);
        }

        const contentType = doc.mimeType
            || upstream.headers.get('content-type')
            || 'application/octet-stream';
        const buffer = Buffer.from(await upstream.arrayBuffer());

        // Force the browser to download with the original file name and extension
        const safeFileName = (doc.originalName ?? 'document').replace(/"/g, '\\"');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length.toString());
        res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
        res.setHeader('Cache-Control', 'no-store');
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
