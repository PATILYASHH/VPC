import useWindowStore from '@/stores/useWindowStore';
import Window from './Window';

export default function WindowManager() {
  const windowIds = useWindowStore((s) => Object.keys(s.windows));

  return (
    <>
      {windowIds.map((id) => (
        <Window key={id} windowId={id} />
      ))}
    </>
  );
}
