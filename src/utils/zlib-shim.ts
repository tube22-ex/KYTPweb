import pako from 'pako';

/**
 * kuromoji.js が zlibjs/bin/gunzip.min.js に期待する構造を
 * pako でエミュレートするシム（互換レイヤー）です。
 */
export const Zlib = {
    Gunzip: class {
        private data: Uint8Array;
        constructor(data: Uint8Array) {
            this.data = data;
        }
        decompress(): Uint8Array {
            // pako.inflate は zlib.Gunzip.decompress() と互換性のある
            // 展開済み Uint8Array を返します。
            return pako.inflate(this.data);
        }
    }
};

export default { Zlib };
