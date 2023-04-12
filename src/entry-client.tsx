import { hydrate } from 'solid-js/web';
import PageRouter from './page-router';
import { LoadResult } from './internal/router';

interface WindowWithSSRData {
  SSR_DATA: LoadResult<any>[]
}

declare const window: Window & WindowWithSSRData;

const root = document.getElementById('root');

if (root) {
  hydrate(() => (
    <PageRouter
      data={window.SSR_DATA}
      pathname={window.location.pathname}
      search={window.location.search}
    />
  ), root);
}
