import express from 'express';
import {
  createServer as createViteServer
} from 'vite';
import path from 'path';
import fs from 'fs/promises';
import 'node-fetch-native/polyfill';
import { serializeAsync } from 'seroval';

function nodeStreamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const buffer = [];

    stream.on('data', (chunk) => buffer.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(buffer)));
    stream.on('error', (err) => reject(err));
  });
}

function getFullUrlFromIncomingMessage(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.connection.encrypted ? 'https' : 'http';
  const host = req.headers.host;
  return `${protocol}://${host}${req.originalUrl}`;
}

async function convertIncomingMessageToRequest(request) {
  if (!request.url || !request.headers.host) {
    throw new Error('Unexpected url');
  }
  const url = getFullUrlFromIncomingMessage(request);
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: (request.method !== 'GET' && request.method !== 'HEAD')
      ? await nodeStreamToBuffer(request)
      : null,
  });
}

async function convertResponseToServerResponse(response, newResponse) {
  // Set status code
  response.statusCode = newResponse.status;
  response.statusMessage = newResponse.statusText;
  // Set headers
  newResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });
  // Set content
  response.end(await newResponse.text());
}

async function createServer() {
  const app = express()
  let loadServerEntry;
  let vite;
  let template;
  
  if (process.env.NODE_ENV === "production") {
    // Use Vite's built asset in prod mode.
    loadServerEntry = () => import("./dist/server/entry-server.mjs");
    template = () => fs.readFile(path.join(process.cwd(), 'dist/client/index.html'), 'utf-8');
    app.use('/assets', express.static(path.join(process.cwd(), 'dist/client/assets')));
  } else {
    // Hookup the vite dev server.
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom'
    })
    app.use(vite.middlewares)
    loadServerEntry = () => vite.ssrLoadModule("./src/entry-server.tsx");
    template = () => fs.readFile(path.join(process.cwd(), 'index.html'), 'utf-8');
  }

  app.use('/*', async (req, res) => {
    try {
      const { default: handle } = await loadServerEntry();
      const result = await handle(
        await convertIncomingMessageToRequest(req),
      );
      if (result instanceof Response) {
        return convertResponseToServerResponse(res, result);
      }
      const html = (await template())
        .replace('<!--meta:outlet-->', result.meta)
        .replace('<!--ssr:data-->', '<script>window.SSR_DATA=' + result.data + '</script>');

      const buffer = html.split('<!--ssr:outlet-->');

      res.status(200).set({ 'Content-Type': 'text/html' });

      let first = true;

      result.content.pipe({
        write(content) {
          if (first) {
            res.write(buffer[0]);
            res.write(content);
            res.write(buffer[1]);
            first = false;
          } else {
            res.write(content);
          }
        },
        end() {
          res.end();
        },
      });
    } catch (e) {
      // If an error is caught, let Vite fix the stracktrace so it maps back to
      // your actual source code.
      if (vite) {
        vite.ssrFixStacktrace(e);
        console.error(e)
        res.status(500).end(await serializeAsync(e))
      } else {
        res.status(500).end('INTERNAL SERVER ERROR');
      }
    }
  });

  app.listen(3000).on('listening', () => {
    console.log('Listening at http://localhost:3000');
  });
}

createServer();