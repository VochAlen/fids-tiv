// types/global.d.ts (novi fajl, ako ne postoji)
export {};

declare global {
  interface Window {
    electronAPI?: {
      quitApp?: () => void;
    };
    chrome?: {
      webview?: {
        postMessage: (message: unknown) => void;
      };
    };
  }
}