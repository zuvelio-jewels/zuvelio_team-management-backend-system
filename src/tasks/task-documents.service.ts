import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class TaskDocumentsService {
    constructor(private prisma: PrismaService) { }

    private readonly uploadDir = path.join(process.cwd(), 'uploads', 'task-documents');

    async create(
        taskId: number,
        file: Express.Multer.File,
        uploadedById: number,
    ) {
        // Ensure task exists
        const task = await this.prisma.task.findUnique({ where: { id: taskId } });
        if (!task) throw new NotFoundException('Task not found');

        return this.prisma.taskDocument.create({
            data: {
                taskId,
                fileName: file.filename,
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                uploadedById,
            },
            include: {
                uploadedBy: { select: { id: true, name: true } },
            },
        });
    }

    async findAllByTask(taskId: number) {
        const task = await this.prisma.task.findUnique({ where: { id: taskId } });
        if (!task) throw new NotFoundException('Task not found');

        return this.prisma.taskDocument.findMany({
            where: { taskId },
            include: { uploadedBy: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'asc' },
        });
    }

    async getFilePath(docId: number): Promise<{ filePath: string; doc: any }> {
        const doc = await this.prisma.taskDocument.findUnique({
            where: { id: docId },
            include: { uploadedBy: { select: { id: true, name: true } } },
        });
        if (!doc) throw new NotFoundException('Document not found');

        const filePath = path.join(this.uploadDir, doc.fileName);
        if (!fs.existsSync(filePath)) {
            throw new NotFoundException('File not found on disk');
        }
        return { filePath, doc };
    }

    async remove(docId: number, requesterId: number, requesterRole: string) {
        const doc = await this.prisma.taskDocument.findUnique({
            where: { id: docId },
            include: { task: true },
        });
        if (!doc) throw new NotFoundException('Document not found');

        // Only the uploader, the task assigner, or admin/manager can delete
        const canDelete =
            doc.uploadedById === requesterId ||
            doc.task.allottedFromId === requesterId ||
            requesterRole === 'ADMIN' ||
            requesterRole === 'MANAGER';

        if (!canDelete) throw new ForbiddenException('Not allowed to delete this document');

        // Remove file from disk
        const filePath = path.join(this.uploadDir, doc.fileName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await this.prisma.taskDocument.delete({ where: { id: docId } });
        return { deleted: true };
    }
}
