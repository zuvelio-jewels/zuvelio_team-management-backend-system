import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter: nodemailer.Transporter;
  private logger = new Logger(MailerService.name);

  constructor(private configService: ConfigService) {
    const mailConfig = {
      host: this.configService.get<string>('SMTP_HOST', 'smtp.gmail.com'),
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<string>('SMTP_SECURE', 'false') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASSWORD'),
      },
    };

    this.transporter = nodemailer.createTransport(mailConfig);
  }

  async sendPasswordResetEmail(
    email: string,
    name: string,
    resetToken: string,
  ): Promise<void> {
    try {
      const frontendUrl = this.configService.get<string>(
        'FRONTEND_URL',
        'http://localhost:80',
      );
      const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

      const htmlContent = this.getPasswordResetTemplate(name, resetLink);

      await this.transporter.sendMail({
        from: this.configService.get<string>(
          'SMTP_FROM_EMAIL',
          'noreply@zuvelio.com',
        ),
        to: email,
        subject: 'Reset Your Password - Zuvelio',
        html: htmlContent,
      });

      this.logger.log(`Password reset email sent to ${email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${email}:`,
        error,
      );
      throw error;
    }
  }

  private getPasswordResetTemplate(name: string, resetLink: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Reset Your Password</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #cf9a43; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
            .button { display: inline-block; padding: 10px 20px; background-color: #cf9a43; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #999; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset Request</h1>
            </div>
            <div class="content">
              <p>Hi ${name},</p>
              <p>We received a request to reset your password. Click the button below to reset your password. This link will expire in 30 minutes.</p>
              <a href="${resetLink}" class="button">Reset Password</a>
              <p>If you didn't request a password reset, you can safely ignore this email.</p>
              <p>Or copy and paste this link in your browser:</p>
              <p><small>${resetLink}</small></p>
            </div>
            <div class="footer">
              <p>&copy; 2026 Zuvelio. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}
