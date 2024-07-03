import { Theme } from "./theme";

export interface AssetFetcher {
  setOnFetchFromCache(cb: (url: string) => Promise<string | undefined>): void;

  addTheme(theme: Theme): void;

  // prefetch etc
  load(): Promise<void>;

  resolve(file: string): string;

  fetch(file: string): Promise<string>;

  fetchHbs(
    file: string,
    encoding: string,
    cb: (e: any | null, data?: string) => void
  ): void;
}
