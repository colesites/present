import { session } from 'electron';

const YOUTUBE_PARTITION = 'persist:present-youtube-props';
const YOUTUBE_EMBED_REFERRER = 'https://present.app/';

const YOUTUBE_REQUEST_FILTER = {
  urls: [
    'https://www.youtube.com/*',
    'https://www.youtube-nocookie.com/*',
    'https://*.googlevideo.com/*',
    'https://*.ytimg.com/*',
  ],
};

const hasHeader = (headers: Record<string, string | string[]>, name: string): boolean =>
  Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());

export const configureYoutubeEmbedSession = (): void => {
  const youtubeSession = session.fromPartition(YOUTUBE_PARTITION);
  youtubeSession.webRequest.onBeforeSendHeaders(
    YOUTUBE_REQUEST_FILTER,
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      if (!hasHeader(requestHeaders, 'referer')) {
        requestHeaders.Referer = YOUTUBE_EMBED_REFERRER;
      }
      callback({ requestHeaders });
    },
  );
};
