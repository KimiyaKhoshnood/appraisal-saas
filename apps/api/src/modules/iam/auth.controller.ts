import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { loginSchema, type LoginInput, type TokenResponse } from '@appraisal/contracts';
import type { Request, Response } from 'express';
import { ENV, Public, ValidBody, type Env } from '../../core';
import { AuthService, type IssuedSession } from './auth.service';

export const REFRESH_COOKIE = 'rt';
const COOKIE_PATH = '/api/auth';

/**
 * Refresh token lives in an httpOnly, SameSite=Strict cookie *without* a Domain attribute: the
 * browser sends it only to the exact sub-domain that set it, so acme's cookie never reaches
 * globex (a free benefit of sub-domain tenancy). The access token stays in memory.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Public({ tenant: 'host' })
  async login(@ValidBody(loginSchema) body: LoginInput, @Res({ passthrough: true }) res: Response): Promise<TokenResponse> {
    return this.respond(await this.auth.login(body), res);
  }

  @Post('refresh')
  @HttpCode(200)
  @Public({ tenant: 'host' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<TokenResponse> {
    try {
      return this.respond(await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]), res);
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @Public({ tenant: 'host' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  private respond(session: IssuedSession, res: Response): TokenResponse {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: session.refreshExpiresAt,
    });
    res.setHeader('Cache-Control', 'no-store');
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }
}
