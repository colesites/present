import { protocol, net } from 'electron';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pathToFileURL } from 'url';
import { isDev } from '../utils/app.utils';

// Webpack entry points (declared globally by Forge)
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const OUTPUT_WINDOW_WEBPACK_ENTRY: string;

/**
 * Register custom protocol schemes as privileged BEFORE app is ready
 * Must be called before app.on('ready')
 */
export const registerProtocolSchemes = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'local-media',
      privileges: {
        standard: true,
        bypassCSP: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
};

/**
 * Register protocol handlers AFTER app is ready
 * Must be called in app.on('ready')
 */
export const registerProtocolHandlers = (): void => {
  // Custom app:// protocol: serve webpack production assets in a way that gives
  // the renderer a proper origin (app://app) instead of file:// (null origin).
  // This is critical for Clerk SDK initialization in production.
  if (!isDev()) {
    protocol.handle('app', (request) => {
      const url = new URL(request.url);
      // url.pathname is e.g. '/main_window' or '/main_window/some-asset.js'
      const mainEntryUrl = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
      const outputEntryUrl = new URL(OUTPUT_WINDOW_WEBPACK_ENTRY);
      const mainDir = path.dirname(mainEntryUrl.pathname);
      const outputDir = path.dirname(outputEntryUrl.pathname);

      const pathname = decodeURIComponent(url.pathname);

      let filePath: string;
      if (pathname === '/main_window' || pathname === '/main_window/') {
        // Serve the main window index.html
        filePath = mainEntryUrl.pathname;
      } else if (pathname === '/output_window' || pathname === '/output_window/') {
        // Serve the output window index.html
        filePath = outputEntryUrl.pathname;
      } else if (pathname.startsWith('/main_window/')) {
        // Asset relative to main window dir
        const relativePath = pathname.slice('/main_window/'.length);
        filePath = path.join(mainDir, relativePath);
      } else if (pathname.startsWith('/output_window/')) {
        // Asset relative to output window dir
        const relativePath = pathname.slice('/output_window/'.length);
        filePath = path.join(outputDir, relativePath);
      } else {
        // Fallback: try relative to main dir
        const relativePath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
        filePath = path.join(mainDir, relativePath);
      }

      // On Windows, strip leading slash from /C:/... paths
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }

      return net.fetch(pathToFileURL(filePath).toString());
    });
  }

  // local-media:// protocol for streaming local video/image files
  protocol.handle('local-media', async (request) => {
    // When standard: true is used, Chrome strictly requires a hostname. 
    // We use a dummy 'media' hostname via `local-media://media/absolute/path`.
    // The `.pathname` extracts the actual absolute path reliably regardless of OS.
    let filePath = decodeURIComponent(new URL(request.url).pathname);
    
    // On Windows, pathname comes out as `/C:/Users/...`, so strip the leading slash.
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1);
    }
    
    try {
      const stat = await fs.promises.stat(filePath);
      const rangeHeader = request.headers.get('Range');
      
      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'video/mp4';
      if (ext === '.webm') contentType = 'video/webm';
      else if (ext === '.mov') contentType = 'video/quicktime';
      else if (ext === '.mkv') contentType = 'video/x-matroska';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.gif') contentType = 'image/gif';
      else if (ext === '.webp') contentType = 'image/webp';

      if (!rangeHeader) {
        const stream = fs.createReadStream(filePath);
        const headers = new Headers();
        headers.set('Content-Length', stat.size.toString());
        headers.set('Content-Type', contentType);
        headers.set('Accept-Ranges', 'bytes');
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
          status: 200,
          headers
        });
      }

      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] && parts[1] !== '' ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = (end - start) + 1;

      const stream = fs.createReadStream(filePath, { start, end });
      const headers = new Headers();
      headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Length', chunksize.toString());
      headers.set('Content-Type', contentType);

      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        statusText: 'Partial Content',
        headers
      });
    } catch (error) {
      console.error('Error handling local-media request:', error);
      return new Response('Not Found', { status: 404 });
    }
  });
};
