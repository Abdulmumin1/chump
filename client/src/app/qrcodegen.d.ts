export namespace qrcodegen {
  class QrCode {
    readonly size: number;
    static encodeText(text: string, ecl: QrCode.Ecc): QrCode;
    getModule(x: number, y: number): boolean;
  }

  namespace QrCode {
    class Ecc {
      static readonly LOW: Ecc;
      static readonly MEDIUM: Ecc;
      static readonly QUARTILE: Ecc;
      static readonly HIGH: Ecc;
    }
  }
}
