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
        let resourceType = 'raw';
        if (doc.url.includes('/image/upload/')) resourceType = 'image';
        else if (doc.url.includes('/video/upload/')) resourceType = 'video';

        // Extract the real version number from the stored URL (e.g. v1777021736).
        // CRITICAL: Cloudinary's HMAC signature is computed against the path that
        // includes the version. If the version is missing or wrong the signature
        // won't match and Cloudinary returns 401 even for type:'upload' resources
        // when "Require signed URLs" is enabled on the account.
        const versionMatch = doc.url.match(/\/v(\d+)\//);
        const version = versionMatch ? parseInt(versionMatch[1], 10) : undefined;

        // For image/video, extract the format extension from the stored URL
        let format: string | undefined;
        if (resourceType !== 'raw') {
            const lastSegment = doc.url.split('?')[0].split('/').pop() ?? '';
            const dotIdx = lastSegment.lastIndexOf('.');
            if (dotIdx !== -1) format = lastSegment.slice(dotIdx + 1);
        }

        // Generate a correctly-signed CDN URL.
        // version: extracted real version ensures the signature matches exactly.
        // force_version: false prevents the SDK overriding the version to a placeholder.
        const signedUrl = cloudinary.url(doc.cloudinaryPublicId, {
            secure: true,
            sign_url: true,
            resource_type: resourceType,
            type: 'upload',
            ...(version ? { version } : {}),
            force_version: false,
            ...(format ? { format } : {}),
        });

        // Fetch server-side (Railway → Cloudinary CDN) so the browser never
        // touches Cloudinary — no CORS, no auth issues on the client side.
        const upstream = await fetch(signedUrl);
        if (!upstream.ok) {
            // Fallback: try the raw stored URL (works if account doesn't enforce signing)
            const fallback = await fetch(doc.url);
            if (!fallback.ok) {
                throw new BadRequestException(`Storage error: ${fallback.status}`);
            }
            const fbType = doc.mimeType || fallback.headers.get('content-type') || 'application/octet-stream';
            const fbBuf = Buffer.from(await fallback.arrayBuffer());
            const safeNameFb = (doc.originalName ?? 'document').replace(/"/g, '\\"');
            res.setHeader('Content-Type', fbType);
            res.setHeader('Content-Length', fbBuf.length.toString());
            res.setHeader('Content-Disposition', `attachment; filename="${safeNameFb}"`);
            res.setHeader('Cache-Control', 'no-store');
            return res.send(fbBuf);
        }

        const contentType = doc.mimeType
            || upstream.headers.get('content-type')
            || 'application/octet-stream';
        const buffer = Buffer.from(await upstream.arrayBuffer());

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
