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
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Response as ExpressResponse } from 'express';
import { TaskDocumentsService } from './task-documents.service';

const multerStorage = diskStorage({
    destination: join(process.cwd(), 'uploads', 'task-documents'),
    filename: (_req, file, cb) => {
        const ext = extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    },
});

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
            storage: multerStorage,
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

    /** Download / view a document */
    @Get('documents/:docId/download')
    async downloadDocument(
        @Param('docId', ParseIntPipe) docId: number,
        @Res() res: ExpressResponse,
    ) {
        const { filePath, doc } = await this.docsService.getFilePath(docId);
        res.setHeader('Content-Type', doc.mimeType);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(doc.originalName)}"`,
        );
        res.sendFile(filePath);
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
