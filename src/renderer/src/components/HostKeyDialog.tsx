import type { HostKeyPrompt } from '../../../shared/types'
import { useT } from '../lib/prefsContext'
import { Modal } from './Modal'

export function HostKeyDialog({
  prompt,
  onAnswer
}: {
  prompt: HostKeyPrompt
  onAnswer(accept: boolean): void
}): React.JSX.Element {
  const t = useT()
  const changed = prompt.kind === 'changed'
  const target = `${prompt.host}${prompt.port !== 22 ? ':' + prompt.port : ''}`
  return (
    <Modal
      title={changed ? t('server.hostKey.changedTitle') : t('server.hostKey.newTitle')}
      onClose={() => onAnswer(false)}
      footer={
        <>
          <button onClick={() => onAnswer(false)}>{t('common.cancel')}</button>
          <button className={changed ? 'danger-solid' : 'primary'} onClick={() => onAnswer(true)}>
            {changed ? t('server.hostKey.replace') : t('server.hostKey.trust')}
          </button>
        </>
      }
    >
      {changed ? (
        <p className="error">{t('server.hostKey.changed', { target })}</p>
      ) : (
        <p>{t('server.hostKey.new', { target })}</p>
      )}
      <p className="mono">
        {prompt.keyType}
        <br />
        {prompt.fingerprint}
      </p>
    </Modal>
  )
}
