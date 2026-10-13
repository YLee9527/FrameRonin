/**
 * 全站 Gemini Pixel Gems 链接；首页「生成大杂烩」与各模块共用。
 * labelKey 对应 `locales.ts` 已有文案键。
 */

export const GEM_RPGMAKER_URL_V1 =
  '#imagegen/gem_rpgmaker_url_v1'
export const GEM_RPGMAKER_URL_V1_1 =
  '#imagegen/gem_rpgmaker_url_v1_1'
export const GEM_RPGMAKER_URL_V3 =
  '#imagegen/gem_rpgmaker_url_v3'
export const GEM_V2_URL = '#imagegen/gem_v2_url'
export const GEM_V2_URL_2 = '#imagegen/gem_v2_url_2'
export const GEM_V3_URL = '#imagegen/gem_v3_url'
export const GEM_MONSTER_ZOMBIE_B1 =
  '#imagegen/gem_monster_zombie_b1'
export const GEM_MONSTER_ZOMBIE_B2 =
  '#imagegen/gem_monster_zombie_b2'
export const GEM_CHAR_V23OT_URL =
  '#imagegen/gem_char_v23ot_url'
export const GEM_SCENE_URL = '#imagegen/gem_scene_url'
export const GEM_SCENE_URL_2 = '#imagegen/gem_scene_url_2'
export const GEM_SCENE_URL_3 = '#imagegen/gem_scene_url_3'
export const GEM_SCENE_URL_4 = '#imagegen/gem_scene_url_4' // 街机场景
export const GEM_ILLUST_URL = '#imagegen/gem_illust_url'
export const GEM_V4TX3_URL = '#imagegen/gem_v4tx3_url'
export const GEM_HORIZONTAL_CHAR_URL =
  '#imagegen/gem_horizontal_char_url'
export const GEM_8DIR_TOPDOWN_URL =
  '#imagegen/gem_8dir_topdown_url'
export const GEM_HORSE_RIDING_URL =
  '#imagegen/gem_horse_riding_url'
export const GEM_ONE_IMAGE_ALL_ACTIONS_URL =
  '#imagegen/gem_one_image_all_actions_url'
export const GEM_ONE_IMAGE_ALL_ACTIONS_2_URL =
  '#imagegen/gem_one_image_all_actions_2_url'
export const GEM_PIXEL_DOG_URL =
  '#imagegen/gem_pixel_dog_url'
export const GEM_PIXEL_BIRD_MONSTER_URL =
  '#imagegen/gem_pixel_bird_monster_url'
export const GEM_PIXEL_JIKUN_URL =
  '#imagegen/gem_pixel_jikun_url'
/** 生成大杂烩 · 吞食天地（S） */
export const GEM_PIXEL_TUNSHITIANDI_S_URL =
  '#imagegen/gem_pixel_tunshitiandi_s_url'
/** 生成大杂烩 · RPG骑马（潜墨千羽） */
export const GEM_PIXEL_RPG_HORSE_QIANMO_URL =
  '#imagegen/gem_pixel_rpg_horse_qianmo_url'
/** 生成大杂烩 · RPGMakerXP（原 RPGold Gem 链接） */
export const GEM_PIXEL_RPGMAKER_XP_URL =
  '#imagegen/gem_pixel_rpgmaker_xp_url'
/** 生成大杂烩 · RPGMakerVX */
export const GEM_PIXEL_RPGMAKER_VX_URL =
  '#imagegen/gem_pixel_rpgmaker_vx_url'
/** 生成大杂烩 · 横版剑士一套（小苏早睡） */
export const GEM_PIXEL_HORIZONTAL_SWORDSMAN_XIAOSU_URL =
  '#imagegen/gem_pixel_horizontal_swordsman_xiaosu_url'

export interface GemPixelPotpourriItem {
  url: string
  labelKey: string
  /** 相对 `public/` 的预览图路径，如 `gempic/吞食天地.png` */
  previewPublicPath?: string
  /** 相对 `public/` 的多张预览图路径数组，如 `['gempic/img1.gif', 'gempic/img2.gif']` */
  previewPublicPaths?: string[]
  /** 在子页 4 列网格中占满一行（用于多图预览等） */
  spanFullRow?: boolean
}

/** 生成大杂烩子页 9 格：`null` 为预留位 */
export const GEM_PIXEL_POTPOURRI_HUB_SLOTS: (GemPixelPotpourriItem | null)[] = [
  {
    url: GEM_PIXEL_TUNSHITIANDI_S_URL,
    labelKey: 'gemPixelPotpourriTunshiTiandiS',
    previewPublicPath: 'gempic/吞食天地.png',
  },
  {
    url: GEM_PIXEL_RPG_HORSE_QIANMO_URL,
    labelKey: 'gemPixelPotpourriRpgHorseQianmo',
    previewPublicPath: 'gempic/riderrpg.png',
  },
  {
    url: GEM_PIXEL_RPGMAKER_XP_URL,
    labelKey: 'gemPixelPotpourriRpgMakerXP',
    previewPublicPath: 'gempic/rpgold.png',
  },
  {
    url: GEM_PIXEL_RPGMAKER_VX_URL,
    labelKey: 'gemPixelPotpourriRpgMakerVX',
    previewPublicPath: 'gempic/RPGMakerVX.png',
  },
  {
    url: GEM_PIXEL_HORIZONTAL_SWORDSMAN_XIAOSU_URL,
    labelKey: 'gemPixelPotpourriHorizontalSwordsmanXiaosu',
    previewPublicPaths: ['jiguo.gif', 'jiguo2.gif', 'jiguo3.gif', 'jiguo4.gif', 'jiguo5.gif'],
    spanFullRow: true,
  },
  null,
  null,
  null,
  null,
  null,
  null,
]

/** 首页「生成大杂烩」按钮顺序；子页每行 4 个由 UI grid 控制 */
export const GEM_PIXEL_POTPOURRI: GemPixelPotpourriItem[] = [
  { url: GEM_RPGMAKER_URL_V1, labelKey: 'moduleNanobananaRpgmakerGemV1' },
  { url: GEM_RPGMAKER_URL_V1_1, labelKey: 'moduleNanobananaRpgmakerGemV1_1' },
  { url: GEM_RPGMAKER_URL_V3, labelKey: 'moduleNanobananaRpgmakerGemV3' },
  { url: GEM_V2_URL, labelKey: 'gemV2Link1' },
  { url: GEM_V2_URL_2, labelKey: 'gemV2Link2' },
  { url: GEM_V3_URL, labelKey: 'gemV2Link3' },
  { url: GEM_MONSTER_ZOMBIE_B1, labelKey: 'moduleGemMonsterZombieB1' },
  { url: GEM_MONSTER_ZOMBIE_B2, labelKey: 'moduleGemMonsterZombieB2' },
  { url: GEM_CHAR_V23OT_URL, labelKey: 'moduleCharGenV23OT' },
  { url: GEM_SCENE_URL, labelKey: 'nanobananaSceneLink1' },
  { url: GEM_SCENE_URL_2, labelKey: 'nanobananaSceneLink2' },
  { url: GEM_SCENE_URL_3, labelKey: 'nanobananaSceneLink3' },
  { url: GEM_SCENE_URL_4, labelKey: 'nanobananaSceneLink4' },
  { url: GEM_ILLUST_URL, labelKey: 'moduleIllust' },
  { url: GEM_V4TX3_URL, labelKey: 'nanobananaFullCharBtn1' },
  { url: GEM_HORIZONTAL_CHAR_URL, labelKey: 'nanobananaFullCharBtn2' },
  { url: GEM_8DIR_TOPDOWN_URL, labelKey: 'nanobananaFullCharBtn3' },
  { url: GEM_HORSE_RIDING_URL, labelKey: 'nanobananaFullCharBtn4' },
  { url: GEM_ONE_IMAGE_ALL_ACTIONS_URL, labelKey: 'nanobananaFullCharBtn5' },
  { url: GEM_ONE_IMAGE_ALL_ACTIONS_2_URL, labelKey: 'nanobananaFullCharBtn6' },
  { url: GEM_PIXEL_DOG_URL, labelKey: 'aiPixelAnimalsGemDog' },
  { url: GEM_PIXEL_BIRD_MONSTER_URL, labelKey: 'aiPixelAnimalsGemBirdMonster' },
  { url: GEM_PIXEL_JIKUN_URL, labelKey: 'aiPixelAnimalsGemJikun' },
]
