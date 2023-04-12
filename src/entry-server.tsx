import { renderToStream } from 'solid-js/web';
import { handleRequest } from 'thaler/server';
import { serializeAsync } from 'seroval';
import { Load, LoadResult } from './internal/router';
import PageRouter from './page-router';
import renderMeta from './internal/meta/render-meta';
import { defineLoaderRouter } from './internal/root';

const getLoader = defineLoaderRouter({
  routes: {
    path: './routes',
    imports: import.meta.glob<true, string, Load>('./routes/**/*.tsx', { import: 'load', eager: true }),
  },
});

export default async function handle(request: Request) {
  const matched = await handleRequest(request);
  if (matched) {
    return matched;
  }
  const url = new URL(request.url);
  const loaders = getLoader(url);
  if (url.searchParams.has('.get')) {
    if (loaders.length) {
      const last = loaders[loaders.length - 1];
      if (last.value) {
        const data = await last.value(request, last.params);
        return new Response(await serializeAsync(data), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }
    }
  }
  let data: LoadResult<any>[] = [];

  if (loaders.length) {
    data = await Promise.all(
      loaders.map(async (result) => {
        if (result.value) {
          return result.value(request, result.params);
        }
        return { props: undefined };
      }),
    );
  }
  for (let i = 0, len = data.length; i < len; i += 1) {
    const current = data[i];
    if ('redirect' in current) {
      return Response.redirect(current.redirect);
    }
  }
  const lastData = data[data.length - 1];
  return {
    data: await serializeAsync(data),
    meta: renderMeta(lastData && 'meta' in lastData ? lastData : undefined),
    content: renderToStream(
      () => (
        <PageRouter
          data={data}
          pathname={url.pathname}
          search={url.pathname}
        />
      ),
    ),
  };
}
