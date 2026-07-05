export type MediaLoadingPolicy = 'cinematic' | 'lean' | 'still'

export type LifeMediaAsset = {
  id: string
  label: string
  alt: string
  sources: {
    webm?: string
    mp4?: string
    mov?: string
    localMp4?: string
  }
}

export type LifeChapterMedia = LifeMediaAsset & {
  eyebrow: string
  title: string
  copy: string
  align?: 'left' | 'right'
}

type BrowserConnection = EventTarget & {
  effectiveType?: string
  saveData?: boolean
}

const DEV_VIDEO_BASE = 'http://127.0.0.1:4174'

const configuredVideoBase = (import.meta.env.VITE_LIFE_MEDIA_BASE as string | undefined)?.replace(/\/$/, '')
const videoBase = configuredVideoBase || (import.meta.env.DEV ? DEV_VIDEO_BASE : '')

function rawVideo(name: string) {
  return videoBase ? `${videoBase}/${encodeURIComponent(name)}` : undefined
}

function lifeAsset({
  id,
  label,
  alt,
  localName,
  sources = {},
}: {
  id: string
  label: string
  alt: string
  localName: string
  sources?: LifeMediaAsset['sources']
}): LifeMediaAsset {
  return {
    id,
    label,
    alt,
    sources: {
      ...sources,
      localMp4: rawVideo(localName),
    },
  }
}

const MEDIA = {
  morningCoast: lifeAsset({
    id: 'morning-coast',
    label: 'Morning coast',
    alt: '清晨山海交界的开阔航拍',
    localName: 'mp4--15.mp4',
  }),
  indonesiaVillageWater: lifeAsset({
    id: 'indonesia-village-water',
    label: 'Village water',
    alt: '日间印尼岛屿村落与水面',
    localName: 'mp4--10.mp4',
  }),
  indonesiaIslandWide: lifeAsset({
    id: 'indonesia-island-wide',
    label: 'Island distance',
    alt: '日间岛屿与海湾的远景',
    localName: 'mp4--11.mp4',
  }),
  indonesiaBoat: lifeAsset({
    id: 'indonesia-boat',
    label: 'Island passage',
    alt: '日间岛屿之间的水路与船影',
    localName: 'mp4--12.mp4',
  }),
  coastalCityDusk: lifeAsset({
    id: 'coastal-city-dusk',
    label: 'Coastal dusk',
    alt: '傍晚海边城市航拍',
    localName: 'mp4--6.mp4',
  }),
  cityDusk: lifeAsset({
    id: 'city-dusk',
    label: 'City dusk',
    alt: '傍晚城市景观航拍',
    localName: 'mp4--2.mp4',
  }),
  cadizNight: lifeAsset({
    id: 'cadiz-night',
    label: 'City after work',
    alt: '夜晚海边城市与灯光',
    localName: 'mp4--8.mp4',
  }),
  dayCity: lifeAsset({
    id: 'day-city',
    label: 'Day city',
    alt: '日间城市景观俯拍',
    localName: 'mp4--1.mp4',
  }),
  tananaCityTop: lifeAsset({
    id: 'tanana-city-top',
    label: 'City above',
    alt: '日间城市三百米俯拍',
    localName: 'mp4--13.mp4',
  }),
  tananaRooftop: lifeAsset({
    id: 'tanana-rooftop',
    label: 'Over the roof',
    alt: '航拍飞过城市屋角',
    localName: 'mp4--14.mp4',
  }),
  alpineRain: lifeAsset({
    id: 'alpine-rain',
    label: 'Rain room',
    alt: '阴雨天山中房屋与远处教堂',
    localName: 'mp4--5.mp4',
  }),
  wildCloud: lifeAsset({
    id: 'wild-cloud',
    label: 'Cloud country',
    alt: '阴天山野全景',
    localName: 'mp4--17.mp4',
  }),
  mountainRoad: lifeAsset({
    id: 'mountain-road',
    label: 'Mountain road',
    alt: '山间道路与越野车',
    localName: 'mp4--16.mp4',
  }),
  boatWater: lifeAsset({
    id: 'boat-water',
    label: 'Fast water',
    alt: '快艇在水面飞驰',
    localName: 'mp4--9.mp4',
  }),
  shipwreckShore: lifeAsset({
    id: 'shipwreck-shore',
    label: 'Shore review',
    alt: '海岸边的沉船与飞鸟',
    localName: 'mp4--7.mp4',
  }),
  runningHorsesWide: lifeAsset({
    id: 'running-horses-wide',
    label: 'Go on',
    alt: '草原上奔跑的马群',
    localName: 'mp4--3.mp4',
  }),
  runningHorsesClose: lifeAsset({
    id: 'running-horses-close',
    label: 'Forward signal',
    alt: '近景奔跑的马群',
    localName: 'mp4--4.mp4',
  }),
  desertHorizon: lifeAsset({
    id: 'desert-horizon',
    label: 'Desert horizon',
    alt: '傍晚荒野沙漠远景',
    localName: 'mp4--18.mp4',
  }),
  desertFire: lifeAsset({
    id: 'desert-fire',
    label: 'Quiet fire',
    alt: '傍晚沙漠中一簇篝火',
    localName: 'mp4--19.mp4',
  }),
} satisfies Record<string, LifeMediaAsset>

export const LIFE_HERO_MEDIA: LifeMediaAsset[] = [
  MEDIA.morningCoast,
  MEDIA.tananaRooftop,
  MEDIA.indonesiaVillageWater,
  MEDIA.mountainRoad,
  MEDIA.coastalCityDusk,
  MEDIA.desertHorizon,
  MEDIA.runningHorsesWide,
  MEDIA.dayCity,
  MEDIA.boatWater,
  MEDIA.alpineRain,
  MEDIA.shipwreckShore,
  MEDIA.indonesiaIslandWide,
  MEDIA.tananaCityTop,
  MEDIA.cityDusk,
  MEDIA.wildCloud,
  MEDIA.desertFire,
  MEDIA.runningHorsesClose,
  MEDIA.indonesiaBoat,
  MEDIA.cadizNight,
]

export const LIFE_CHAPTER_MEDIA: LifeChapterMedia[] = [
  {
    ...MEDIA.wildCloud,
    id: 'chapter-wide-view',
    label: 'Wide view',
    eyebrow: 'Perspective first',
    title: '先把视线交给远方。',
    copy: '数据不是生活的边界。它只是提醒你：工作带来了什么，能量流向哪里，以及下一段路该不该轻一点。',
  },
  {
    ...MEDIA.alpineRain,
    id: 'chapter-quiet-state',
    label: 'Quiet state',
    eyebrow: 'A quieter signal',
    title: '状态需要安静地出现。',
    copy: '汐账把流水压低，把反馈放大。你不必盯着每一笔钱，只需要知道哪些变化值得被看见。',
    align: 'right',
  },
  {
    ...MEDIA.boatWater,
    id: 'chapter-records-return',
    label: 'Records return',
    eyebrow: 'Records return',
    title: '记录归流，注意力归你。',
    copy: '多源账单只是潮汐。它们进来、被归类、被校准，然后沉到背景里，不再占据你的整天。',
  },
  {
    ...MEDIA.shipwreckShore,
    id: 'chapter-low-point',
    label: 'Low point',
    eyebrow: 'Review once',
    title: '失衡处，只需要被看见一次。',
    copy: '重复、退款、未分类和异常支出被放进复核队列。处理它们，不是为了反复自责，而是为了重新获得方向。',
    align: 'right',
  },
  {
    ...MEDIA.runningHorsesWide,
    id: 'chapter-forward',
    label: 'Forward',
    eyebrow: 'Go on',
    title: '处理完，就继续向前。',
    copy: '账单的意义不是让你留下来，而是让你更清楚地离开。看见反馈，校准节奏，然后把人生过大一点。',
  },
  {
    ...MEDIA.cadizNight,
    id: 'chapter-night-close',
    label: 'Night close',
    eyebrow: 'Close the ledger',
    title: '夜色落下时，账本也该合上。',
    copy: '控制区留在最后。因为真正重要的不是配置了多少能力，而是你能不能在知道状态之后，放心去生活。',
    align: 'right',
  },
]

export function getBrowserConnection(): BrowserConnection | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as Navigator & {
    connection?: BrowserConnection
    mozConnection?: BrowserConnection
    webkitConnection?: BrowserConnection
  }
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null
}

export function getMediaLoadingPolicy(): MediaLoadingPolicy {
  if (typeof window === 'undefined') return 'lean'

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const connection = getBrowserConnection()
  const saveData = Boolean(connection?.saveData)
  const effectiveType = connection?.effectiveType ?? ''
  const slowConnection = effectiveType === 'slow-2g' || effectiveType === '2g'

  if (reduceMotion || saveData || slowConnection) return 'lean'
  if (effectiveType === '3g') return 'lean'
  return 'cinematic'
}

export function resolveLifeVideoSource(asset: LifeMediaAsset, policy: MediaLoadingPolicy) {
  if (policy === 'still') return null
  if (policy === 'lean') return asset.sources.mp4 ?? asset.sources.webm ?? asset.sources.mov ?? asset.sources.localMp4 ?? null
  return asset.sources.webm ?? asset.sources.mp4 ?? asset.sources.mov ?? asset.sources.localMp4 ?? null
}

export function shouldWarmNextAsset(policy: MediaLoadingPolicy) {
  return policy === 'cinematic'
}
