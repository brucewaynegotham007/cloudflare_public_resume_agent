export {};

declare global {
  interface Env {
    GITHUB_TOKEN: string;
    APP_PASSWORD: string;
    APP_SESSION_TOKEN: string;
    ACTION_CALLBACK_TOKEN: string;
  }

  namespace Cloudflare {
    interface Env {
      GITHUB_TOKEN: string;
      APP_PASSWORD: string;
      APP_SESSION_TOKEN: string;
      ACTION_CALLBACK_TOKEN: string;
    }
  }
}