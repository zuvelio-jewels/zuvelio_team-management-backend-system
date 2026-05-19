import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter: nodemailer.Transporter;
  private logger = new Logger(MailerService.name);

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST', 'smtp.zoho.in');
    const port = this.configService.get<number>('SMTP_PORT', 587);
    const secure = this.configService.get<string>('SMTP_SECURE', 'false') === 'true';
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASSWORD');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,                          // true = SSL (465), false = STARTTLS (587)
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    // Verify SMTP on startup so misconfiguration is caught early
    this.transporter.verify((error) => {
      if (error) {
        this.logger.error(
          `SMTP connection FAILED [${host}:${port} secure=${secure}] — ${error.message}\n` +
          `Fix: (1) Enable SMTP in Zoho Mail → Settings → Security → App Passwords\n` +
          `     (2) If 2FA is ON, use an App Password as SMTP_PASSWORD\n` +
          `     (3) Try SMTP_PORT=465 with SMTP_SECURE=true OR port=587 secure=false`,
        );
      } else {
        this.logger.log(`SMTP connection verified [${host}:${port} secure=${secure}] user=${user}`);
      }
    });
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
          'support@zuvelio.org',
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

  async sendOtpEmail(email: string, name: string, otp: string): Promise<void> {
    try {
      const htmlContent = this.getOtpTemplate(name, otp);

      await this.transporter.sendMail({
        from: this.configService.get<string>(
          'SMTP_FROM_EMAIL',
          'support@zuvelio.org',
        ),
        to: email,
        subject: 'Your Sign-In Verification Code - Zuvelio',
        html: htmlContent,
      });

      this.logger.log(`OTP email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP email to ${email}:`, error);
      throw error;
    }
  }

  private getOtpTemplate(name: string, otp: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Your Verification Code</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #cf9a43; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
            .otp-box { background-color: #ffffff; border: 2px solid #cf9a43; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
            .otp-code { font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #cf9a43; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #999; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Sign-In Verification</h1>
            </div>
            <div class="content">
              <p>Hi ${name},</p>
              <p>Use the code below to complete your sign-in. This code expires in <strong>10 minutes</strong>.</p>
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
              </div>
              <p>If you did not attempt to sign in, please ignore this email and consider changing your password.</p>
              <p><strong>Never share this code with anyone.</strong></p>
            </div>
            <div class="footer">
              <p>&copy; 2026 Zuvelio. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;
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
