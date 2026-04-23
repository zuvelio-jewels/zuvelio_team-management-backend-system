import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class TaskDocumentsService {
    constructor(private prisma: PrismaService) { }

    async create(
        taskId: number,
        file: Express.Multer.File,
        uploadedById: number,
    ) {
        const task = await this.prisma.task.findUnique({ where: { id: taskId } });
        if (!task) throw new NotFoundException('Task not found');

        // CloudinaryStorage sets file.path = secure_url, file.filename = public_id
        return this.prisma.taskDocument.create({
            data: {
                taskId,
                fileName: file.filename,
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                url: (file as any).path,
                cloudinaryPublicId: file.filename,
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

    async getDocument(docId: number) {
        const doc = await this.prisma.taskDocument.findUnique({
            where: { id: docId },
            include: { uploadedBy: { select: { id: true, name: true } } },
        });
        if (!doc) throw new NotFoundException('Document not found');
        return doc;
    }

    async remove(docId: number, requesterId: number, requesterRole: string) {
        const doc = await this.prisma.taskDocument.findUnique({
            where: { id: docId },
            include: { task: true },
        });
        if (!doc) throw new NotFoundException('Document not found');

        const canDelete =
            doc.uploadedById === requesterId ||
            doc.task.allottedFromId === requesterId ||
            requesterRole === 'ADMIN' ||
            requesterRole === 'MANAGER';

        if (!canDelete) throw new ForbiddenException('Not allowed to delete this document');

        // Delete from Cloudinary
        if (doc.cloudinaryPublicId) {
            try {
                const resourceType = doc.mimeType.startsWith('image/') ? 'image' : 'raw';
                await cloudinary.uploader.destroy(doc.cloudinaryPublicId, { resource_type: resourceType });
            } catch (err) {
                console.error('Cloudinary delete error:', err);
            }
        }

        await this.prisma.taskDocument.delete({ where: { id: docId } });
        return { deleted: true };
    }
}
