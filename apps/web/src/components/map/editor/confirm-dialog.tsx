import { Button, Dialog } from '../../ui';

// 编辑器里「做了就不能撤销」的确认框（拿掉、合并；拍板 2）：正文写清后果，确认按钮是危险色，确认时轻振一下。

export interface ConfirmRequest {
  title: string;
  body: string;
  action: string;
  run: () => void;
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  return (
    <Dialog
      title={request.title}
      onClose={onClose}
      maxWidth={400}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button className="bg-danger hover:bg-danger" onClick={() => { request.run(); onClose(); navigator.vibrate?.(12); }}>
            {request.action}
          </Button>
        </div>
      }
    >
      <p className="text-[14px] leading-relaxed text-ink-soft">{request.body}</p>
    </Dialog>
  );
}
