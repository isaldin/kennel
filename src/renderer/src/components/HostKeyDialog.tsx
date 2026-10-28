import type { HostKeyPrompt } from '../../../shared/types'
import { Modal } from './Modal'

export function HostKeyDialog({
  prompt,
  onAnswer
}: {
  prompt: HostKeyPrompt
  onAnswer(accept: boolean): void
}): React.JSX.Element {
  const changed = prompt.kind === 'changed'
  const target = `${prompt.host}${prompt.port !== 22 ? ':' + prompt.port : ''}`
  return (
    <Modal
      title={changed ? '⚠️ Ключ сервера изменился' : 'Новый сервер'}
      onClose={() => onAnswer(false)}
      footer={
        <>
          <button onClick={() => onAnswer(false)}>Отмена</button>
          <button className={changed ? 'danger-solid' : 'primary'} onClick={() => onAnswer(true)}>
            {changed ? 'Заменить ключ и подключиться' : 'Доверять и подключиться'}
          </button>
        </>
      }
    >
      {changed ? (
        <p className="error">
          Ключ {target} не совпадает с записью в ~/.ssh/known_hosts. Так бывает после переустановки
          сервера, но может означать и перехват соединения. Подтверждай, только если знаешь причину.
        </p>
      ) : (
        <p>Подключение к {target} впервые. Отпечаток будет добавлен в ~/.ssh/known_hosts.</p>
      )}
      <p className="mono">
        {prompt.keyType}
        <br />
        {prompt.fingerprint}
      </p>
    </Modal>
  )
}
