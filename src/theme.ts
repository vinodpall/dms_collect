import { theme as antdTheme } from 'ant-design-vue'

const font = "'IBM Plex Sans','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',system-ui,sans-serif"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTheme(dark: boolean): any {
  const c = dark
    ? { primary: '#16A9C4', bg: '#0f1f35', surface: '#162A45', s2: '#1B3352', s3: '#243f63', line: '#2B4A6D', line2: '#3d6691', text: '#F3F8FC', muted: '#B6CADC', ok: '#45E3A8', warn: '#FFC15C', err: '#FF7A7A' }
    : { primary: '#1565C0', bg: '#F2F5F9', surface: '#FFFFFF', s2: '#F7F9FC', s3: '#EDF1F6', line: '#E1E7EF', line2: '#C9D2DE', text: '#202c48', muted: '#7d7b9c', ok: '#22A06B', warn: '#E8A317', err: '#D92D20' }
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: c.primary,
      colorSuccess: c.ok,
      colorWarning: c.warn,
      colorError: c.err,
      colorInfo: c.primary,
      colorBgBase: c.surface,
      colorBgLayout: c.bg,
      colorBgContainer: c.surface,
      colorBgElevated: c.surface,
      colorTextBase: c.text,
      colorText: c.text,
      colorTextSecondary: c.muted,
      colorBorder: c.line2,
      colorBorderSecondary: c.line,
      colorFillAlter: c.s2,
      colorFillSecondary: c.s3,
      borderRadius: 4,
      borderRadiusLG: 6,
      borderRadiusSM: 3,
      fontFamily: font,
      colorPrimaryText: dark ? '#2ED3E6' : c.primary,
      fontSize: 14,
      controlHeight: 36,
      wireframe: false,
      motionDurationMid: '0.15s',
    },
    components: {
      Table: { headerBg: c.s2, headerColor: c.muted, headerSplitColor: 'transparent', rowHoverBg: c.s2, cellPaddingBlock: 12, borderColor: c.line },
      Card: { borderRadiusLG: 6, headerFontSize: 15 },
      Button: { fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
      Modal: { borderRadiusLG: 6 },
      Drawer: { borderRadiusLG: 0 },
      Tabs: { horizontalMargin: '0', titleFontSize: 14 },
      Segmented: { trackBg: c.s3, itemSelectedBg: c.surface },
      Progress: { remainingColor: c.s3 },
      Steps: { iconSize: 26 },
    },
  }
}
