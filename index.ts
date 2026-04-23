#!/usr/bin/env bun
/**
 * index.ts
 *
 * Minimal Bun server that proves `authenticationMethod` is returned by the
 * WorkOS Node SDK from BOTH of the relevant success paths:
 *   1. `authenticateWithCode()`            — the initial code-for-session exchange
 *   2. `authenticateWithSessionCookie()`   — the per-request session verification
 *
 * Both responses render as syntax-highlighted JSON (via ExpressiveCode) with
 * the `authenticationMethod` field visually highlighted.
 *
 * Setup:
 *   1. Install Bun: https://bun.sh
 *   2. Export env vars:
 *        WORKOS_API_KEY=sk_test_...
 *        WORKOS_CLIENT_ID=client_...
 *        # optional: WORKOS_COOKIE_PASSWORD (32+ chars; auto-generated if unset)
 *        # optional: PORT (default 3000)
 *   3. Add http://localhost:3000/callback to your AuthKit redirect URIs
 *      in the WorkOS dashboard.
 *   4. Run: `bun run index.ts`
 *   5. Open http://localhost:3000 and log in.
 */

import { randomBytes } from 'node:crypto';
import { WorkOS } from '@workos-inc/node';
import { ExpressiveCode, ExpressiveCodeTheme } from 'expressive-code';
import { toHtml } from 'expressive-code/hast';
import { bundledThemes } from 'shiki';

const apiKey = process.env.WORKOS_API_KEY;
const clientId = process.env.WORKOS_CLIENT_ID;
const port = Number(process.env.PORT ?? 3000);
const redirectUri = `http://localhost:${port}/callback`;
const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD ?? randomBytes(32).toString('hex');

if (!apiKey || !clientId) {
  console.error('Set WORKOS_API_KEY and WORKOS_CLIENT_ID in your environment.');
  process.exit(1);
}

const workos = new WorkOS(apiKey, { clientId });

const githubDark = new ExpressiveCodeTheme(await bundledThemes['github-dark']().then((m) => m.default));
const ec = new ExpressiveCode({ themes: [githubDark] });

async function renderJson(value: unknown) {
  const code = JSON.stringify(value, null, 2);
  const { renderedGroupAst, styles } = await ec.render({
    code,
    language: 'json',
    meta: 'mark="authenticationMethod"',
  });
  const baseStyles = await ec.getBaseStyles();
  const themeStyles = await ec.getThemeStyles();
  return {
    codeHtml: toHtml(renderedGroupAst),
    css: [baseStyles, themeStyles, ...Array.from(styles)].join('\n'),
  };
}

function htmlShell(body: string, extraCss = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AuthKit authenticationMethod demo</title>
  <style>
    :root { color-scheme: dark; }
    body {
      font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0; padding: 3rem 1.5rem;
      background: #0d1117; color: #e6edf3;
    }
    main { max-width: 860px; margin: 0 auto; }
    h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
    p.muted { color: #8b949e; margin-top: 0; }
    a.button {
      display: inline-block; padding: .7rem 1.25rem;
      background: #6366f1; color: #fff; text-decoration: none;
      font-weight: 600; border-radius: .5rem;
    }
    a.button:hover { background: #4f46e5; }
    code.inline {
      background: #161b22; padding: .1rem .4rem; border-radius: 4px;
      font-size: .92em;
    }
  </style>
  ${extraCss ? `<style>${extraCss}</style>` : ''}
</head>
<body><main>${body}</main></body>
</html>`;
}

function preview(token: string | undefined) {
  if (!token) return token;
  if (token.length <= 16) return '<redacted>';
  return `${token.slice(0, 8)}…${token.slice(-6)}`;
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/') {
      const authorizationUrl = workos.userManagement.getAuthorizationUrl({
        provider: 'authkit',
        redirectUri,
        clientId,
      });

      return new Response(
        htmlShell(`
          <h1>AuthKit <code class="inline">authenticationMethod</code> demo</h1>
          <p class="muted">
            Log in via AuthKit; the next page shows the raw authentication
            response with <code class="inline">authenticationMethod</code> highlighted.
          </p>
          <p><a class="button" href="${authorizationUrl}">Log in with AuthKit</a></p>
        `),
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      if (!code) {
        return new Response(
          htmlShell('<h1>Missing <code class="inline">code</code> parameter.</h1>'),
          { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }

      // Step 1: exchange the code for a session. Ask the SDK to seal the session
      //         so we can round-trip it through authenticateWithSessionCookie next.
      const auth = await workos.userManagement.authenticateWithCode({
        code,
        clientId,
        session: { sealSession: true, cookiePassword },
      });

      const codeDisplay = {
        ...auth,
        accessToken: preview(auth.accessToken),
        refreshToken: preview(auth.refreshToken),
        sealedSession: auth.sealedSession ? preview(auth.sealedSession) : undefined,
      };
      const codeRender = await renderJson(codeDisplay);

      // Step 2: verify the sealed session the same way a per-request middleware would.
      //         The response includes `authenticationMethod` with no extra API call.
      let cookieBlockHtml: string;
      let cookieCss = '';
      if (!auth.sealedSession) {
        cookieBlockHtml = `
          <p class="muted"><em>sealedSession was not returned, so the second verification was skipped.</em></p>
        `;
      } else {
        const verified = await workos.userManagement.authenticateWithSessionCookie({
          sessionData: auth.sealedSession,
          cookiePassword,
        });

        const cookieDisplay = verified.authenticated
          ? { ...verified, accessToken: preview(verified.accessToken) }
          : verified;
        const cookieRender = await renderJson(cookieDisplay);
        cookieBlockHtml = cookieRender.codeHtml;
        cookieCss = cookieRender.css;
      }

      return new Response(
        htmlShell(
          `
          <h1>Test 1 &mdash; <code class="inline">authenticateWithCode()</code></h1>
          <p class="muted">
            Initial code exchange. <code class="inline">authenticationMethod</code> is returned
            at the top level of the auth response. Access / refresh / sealed tokens are
            redacted; everything else is verbatim.
          </p>
          ${codeRender.codeHtml}

          <h1 style="margin-top: 3rem;">Test 2 &mdash; <code class="inline">authenticateWithSessionCookie()</code></h1>
          <p class="muted">
            The sealed session cookie from Test 1 is passed to
            <code class="inline">authenticateWithSessionCookie()</code> the same way a
            per-request middleware would. No extra API call is made; the field is unpacked
            locally from the sealed cookie and returned on the success branch.
          </p>
          ${cookieBlockHtml}

          <p class="muted" style="margin-top: 2rem;">
            Same value in both responses, which is why the SDK guarantees it's stable for
            the lifetime of the session (and preserved across
            <code class="inline">authenticateWithRefreshToken()</code>).
          </p>
          `,
          `${codeRender.css}\n${cookieCss}`,
        ),
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(`Listening on http://localhost:${port}`);
console.log(`Make sure ${redirectUri} is in your AuthKit redirect URIs.`);
