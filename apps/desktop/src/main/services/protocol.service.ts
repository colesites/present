import { protocol, net } from 'electron';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath, pathToFileURL } from 'url';
import { isDev } from '../utils/app.utils';
import { getLatestNdiInputFrame } from './ndi.service';

// Webpack entry points (declared globally by Forge)
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const OUTPUT_WINDOW_WEBPACK_ENTRY: string;

const resolveWebpackEntryPath = (entry: string): string => {
  try {
    const parsed = new URL(entry);
    if (parsed.protocol === 'file:') {
      return fileURLToPath(parsed);
    }
    return decodeURIComponent(parsed.pathname);
  } catch {
    return entry;
  }
};

const resolveInside = (baseDir: string, relativePath: string): string | null => {
  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedPath = path.resolve(resolvedBaseDir, relativePath);
  if (resolvedPath !== resolvedBaseDir && !resolvedPath.startsWith(`${resolvedBaseDir}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
};

const firstExistingPath = (paths: Array<string | null>): string | null =>
  paths.find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate))) ?? null;

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
    {
      scheme: 'ndi-frame',
      privileges: {
        standard: true,
        bypassCSP: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
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
    const mainEntryPath = resolveWebpackEntryPath(MAIN_WINDOW_WEBPACK_ENTRY);
    const outputEntryPath = resolveWebpackEntryPath(OUTPUT_WINDOW_WEBPACK_ENTRY);
    const mainDir = path.dirname(mainEntryPath);
    const outputDir = path.dirname(outputEntryPath);
    const rendererRootDir = path.dirname(mainDir);

    protocol.handle('app', (request) => {
      const url = new URL(request.url);
      // url.pathname is e.g. '/main_window' or '/main_window/some-asset.js'
      const pathname = decodeURIComponent(url.pathname);

      let filePath: string | null;
      if (pathname === '/main_window' || pathname === '/main_window/') {
        // Serve the main window index.html
        filePath = mainEntryPath;
      } else if (pathname === '/output_window' || pathname === '/output_window/') {
        // Serve the output window index.html
        filePath = outputEntryPath;
      } else if (pathname.startsWith('/main_window/')) {
        // Assets may be inside the entry folder or emitted from the shared renderer root.
        const relativePath = pathname.slice('/main_window/'.length);
        filePath = firstExistingPath([
          resolveInside(mainDir, relativePath),
          resolveInside(rendererRootDir, pathname.slice(1)),
        ]);
      } else if (pathname.startsWith('/output_window/')) {
        // Assets may be inside the entry folder or emitted from the shared renderer root.
        const relativePath = pathname.slice('/output_window/'.length);
        filePath = firstExistingPath([
          resolveInside(outputDir, relativePath),
          resolveInside(rendererRootDir, pathname.slice(1)),
        ]);
      } else {
        // Forge emits split chunks as renderer-root siblings, e.g. renderer/821/index.js.
        const relativePath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
        filePath = firstExistingPath([
          resolveInside(rendererRootDir, relativePath),
          resolveInside(mainDir, relativePath),
        ]);
      }

      if (!filePath) {
        console.error('[Protocol] app:// asset not found', {
          requestUrl: request.url,
        });
        return new Response('Not Found', { status: 404 });
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
      else if (ext === '.mp3') contentType = 'audio/mpeg';
      else if (ext === '.wav') contentType = 'audio/wav';
      else if (ext === '.m4a') contentType = 'audio/mp4';
      else if (ext === '.aac') contentType = 'audio/aac';
      else if (ext === '.ogg') contentType = 'audio/ogg';
      else if (ext === '.flac') contentType = 'audio/flac';
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

  protocol.handle('ndi-frame', (request) => {
    const url = new URL(request.url);
    const sourceName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const frame = getLatestNdiInputFrame(sourceName || null);
    if (!frame.data) {
      return new Response(null, {
        status: 204,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }
    return new Response(new Uint8Array(frame.data), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'image/png',
        'X-NDI-Frame-Updated-At': String(frame.updatedAtMs),
      },
    });
  });
};
