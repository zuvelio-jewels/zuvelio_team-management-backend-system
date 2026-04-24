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

    /** Download a task document — fetches via Cloudinary API endpoint (bypasses CDN access restrictions) */
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

        // Map MIME type → Cloudinary format string for cases where the URL
        // has no extension (e.g. PDFs stored as Cloudinary image resources).
        const MIME_TO_FORMAT: Record<string, string> = {
            'application/pdf': 'pdf',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'application/msword': 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'application/vnd.ms-excel': 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
            'text/plain': 'txt',
        };

        // Extract format (file extension) for non-raw resources.
        // Raw resources (txt, csv, etc.) have no extension in their Cloudinary URL.
        // For PDFs stored as image resources the URL also has no extension,
        // so fall back to the MIME-type mapping.
        let format = '';
        if (resourceType !== 'raw') {
            const lastSegment = doc.url.split('?')[0].split('/').pop() ?? '';
            const dotIdx = lastSegment.lastIndexOf('.');
            if (dotIdx !== -1) {
                format = lastSegment.slice(dotIdx + 1);
            } else if (doc.mimeType) {
                format = MIME_TO_FORMAT[doc.mimeType] ?? '';
            }
        }

        // private_download_url with type:'upload' generates a URL to
        // https://api.cloudinary.com/v1_1/{cloud}/{resource_type}/download
        // — the Cloudinary API server, NOT the CDN (res.cloudinary.com).
        // The URL is signed with api_key + api_secret via the full API signing method,
        // which is completely separate from CDN URL signing and bypasses all
        // CDN-level access restrictions (signed-URL enforcement, IP restrictions, etc.).
        //
        // KEY DIFFERENCE from previous attempts:
        //   type:'private' (old attempt) → 404 because resources are type:'upload'
        //   type:'upload'  (this fix)    → correct — matches how files were stored
        const apiDownloadUrl = (cloudinary.utils as any).private_download_url(
            doc.cloudinaryPublicId,
            format,
            {
                resource_type: resourceType,
                type: 'upload',
                expires_at: Math.floor(Date.now() / 1000) + 300, // 5-min expiry
            },
        );

        // Fetch server-side: Railway → api.cloudinary.com (authenticated)
        // The browser never touches Cloudinary at all.
        const upstream = await fetch(apiDownloadUrl);
        if (!upstream.ok) {
            throw new BadRequestException(`Storage fetch error: ${upstream.status}`);
        }

        const contentType = doc.mimeType
            || upstream.headers.get('content-type')
            || 'application/octet-stream';
        const buffer = Buffer.from(await upstream.arrayBuffer());

        // Force download with the exact original filename and extension
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
