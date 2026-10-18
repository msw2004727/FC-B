import './bottom-sheet.css';
import { DialogFrame, type ModalProps } from '@/ui/Modal';

export interface BottomSheetProps extends ModalProps {}

export function BottomSheet(props: BottomSheetProps) {
  return <DialogFrame {...props} kind="bottom-sheet" />;
}
