import { ipcMain, net } from 'electron';

/**
 * Fetch JSON following redirects
 */
async function fetchJsonFollowingRedirects(url: string, maxRedirects = 5): Promise<unknown> {
  let currentUrl = url;
  for (let i = 0; i <= maxRedirects; i += 1) {
    const response = await net.fetch(currentUrl, { cache: 'no-store' });
    
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect without location header (${response.status})`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    
    return await response.json();
  }
  throw new Error('Too many redirects');
}

/**
 * Register network-related IPC handlers
 */
export const registerNetworkIPC = (): void => {
  // Fetch hosted Bible catalog
  ipcMain.handle('fetch-hosted-bible-catalog', async (_, catalogUrl: string) => {
    try {
      if (typeof catalogUrl !== 'string' || catalogUrl.trim().length === 0) {
        throw new Error('Missing catalog URL');
      }
      return await fetchJsonFollowingRedirects(catalogUrl);
    } catch (error) {
      console.error('Failed to fetch hosted bible catalog', error);
      return null;
    }
  });
};
