export interface CharacterDefinition {
  id: string;
  name: string;
  image: string;
  scale?: number;        // 拡大率 (1.0 = 100%)
  taraiOffset?: number;  // たらいの着地位置 (px、0がコンテナ上端)
  taraiScale?: number;   // たらい自体の拡大率 (1.0が標準)
  verticalOffset?: number; // キャラクターの上下位置調整 (px、マイナスで上へ)
  tagOffset?: number;    // YOU/HOSTタグの左右位置調整 (px、マイナスで左へ)
}

export const CHARACTERS: Record<string, CharacterDefinition> = {
  chara1: {
    id: "chara1",
    name: "キャラクター1",
    image: "/images/characters/chara1.png",
    scale: 0.8,
    taraiOffset: 60,
    taraiScale: 1.0,
    verticalOffset: 10,
    tagOffset: 55,
  },
  chara2: {
    id: "chara2",
    name: "キャラクター2",
    image: "/images/characters/chara2.png",
    scale: 0.8,         // 座っているので少し小さく
    taraiOffset: 15,   // 位置が低めなのでプラス方向
    taraiScale: 0.9,    // キャラに合わせて少し小さく
    verticalOffset: 0,
    tagOffset: 0,
  },
  chara3: {
    id: "chara3",
    name: "キャラクター3",
    image: "/images/characters/chara3.png",
    scale: 0.8,
    taraiOffset: -20,
    taraiScale: 1.0,
    verticalOffset: -20, // 脚がはみ出さないように上に調整
    tagOffset: 50,
  },
};

export const DEFAULT_CHARACTER_ID = "chara1";
