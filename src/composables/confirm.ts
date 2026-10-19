import { Modal } from 'ant-design-vue'
import { h } from 'vue'

/** 确认框：返回 Promise<boolean>。msg 说明后果，danger 为危险操作样式。 */
export function confirmDlg(o: { title: string; msg: string; ok?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: o.title,
      content: h('p', { style: 'color:var(--muted);line-height:1.7;margin:0' }, o.msg),
      okText: o.ok ?? '确认',
      cancelText: '取消',
      okButtonProps: o.danger ? { danger: true } : undefined,
      centered: true,
      icon: null,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}
