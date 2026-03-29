// global.d.ts
export {};

declare global {
  interface Window {
    electronAPI?: {
      quitApp: () => void;
      getConfig: () => Promise<any>;
      test: () => string;
      getVersion: () => {
        electron: string;
        chrome: string;
        node: string;
      };
    };
  }
}