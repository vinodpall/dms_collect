import { theme as antdTheme } from 'ant-design-vue'

const font = "'IBM Plex Sans','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',system-ui,sans-serif"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTheme(dark: boolean): any {
  const c = dark
    ? { primary: '#5BA3F2', bg: '#0C1219', surface: '#131B25', s2: '#17212D', s3: '#1D2937', line: '#243040', line2: '#33445A', text: '#E4ECF5', muted: '#9DACBF', ok: '#3DBB80', warn: '#F2B94B', err: '#F0584D' }
    : { primary: '#1565C0', bg: '#F2F5F9', surface: '#FFFFFF', s2: '#F7F9FC', s3: '#EDF1F6', line: '#E1E7EF', line2: '#C9D2DE', text: '#132033', muted: '#566579', ok: '#22A06B', warn: '#E8A317', err: '#D92D20' }
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
      borderRadius: 8,
      borderRadiusLG: 12,
      borderRadiusSM: 6,
      fontFamily: font,
      fontSize: 14,
      controlHeight: 36,
      wireframe: false,
      motionDurationMid: '0.15s',
    },
    components: {
      Table: { headerBg: c.s2, headerColor: c.muted, headerSplitColor: 'transparent', rowHoverBg: c.s2, cellPaddingBlock: 12, borderColor: c.line },
      Card: { borderRadiusLG: 12, headerFontSize: 15 },
      Button: { fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
      Modal: { borderRadiusLG: 14 },
      Drawer: { borderRadiusLG: 0 },
      Tabs: { horizontalMargin: '0', titleFontSize: 14 },
      Segmented: { trackBg: c.s3, itemSelectedBg: c.surface },
      Progress: { remainingColor: c.s3 },
      Steps: { iconSize: 26 },
    },
  }
}
