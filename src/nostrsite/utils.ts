
export function isBlossomUrl(u: string) {
  const url = new URL(u);
  const pathExt = url.pathname.split(".");
  const segments = pathExt[0].split("/");
  // path must be /sha256-hex(.ext)?
  const isNot = pathExt.length > 2 || segments.length > 2 || segments[1].length != 64;
  return !isNot;
}

export interface PromiseQueueCb {
  cb: (...args: any[]) => Promise<void>
  args: any[]
}

export class PromiseQueue {
  queue: PromiseQueueCb[] = []

  constructor() {}

  appender(cb: (...cbArgs: any[]) => Promise<void>): (...apArgs: any[]) => void {
    return (...args) => {
      this.queue.push({ cb, args })
      if (this.queue.length === 1) this.execute()
    }
  }

  async execute() {
    // the next cb in the queue
    const { cb, args } = this.queue[0]

    // execute the next cb
    await cb(...args)

    // mark the last cb as done
    this.queue.shift()

    // have the next one? proceed
    if (this.queue.length > 0) this.execute()
  }
}
