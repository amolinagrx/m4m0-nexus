declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      url: string,
      options?: { wsProtocols?: string[]; credentials?: { password: string } },
    );
    scaleViewport: boolean;
    resizeSession: boolean;
    disconnect(): void;
    sendCredentials(credentials: { password: string }): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
  }
}
