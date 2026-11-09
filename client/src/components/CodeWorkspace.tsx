import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { MissionChallenge } from '../network/socket';
import { socket, type ErrorCode } from '../network/socket';

type Props = {
  task: MissionChallenge;
  missionTitle: string;
  missionId: string;
};

// Gemini can take several seconds; the contract asks for at least 20 s.
const REVIEW_TIMEOUT_MS = 20000;

// Friendly terminal text for each error the server can send back.
function reviewErrorText(error: ErrorCode): string {
  switch (error) {
    case 'REVIEW_UNAVAILABLE': return 'The AI reviewer is busy right now. Wait a few seconds and press Run Tests again.';
    case 'REVIEW_IN_PROGRESS': return 'Your previous code is still being reviewed. Please wait.';
    case 'CODE_TOO_LONG': return 'Your code is too long (max 10,000 characters).';
    case 'NOT_IN_MISSION': return 'The mission is no longer running, so this result was not counted.';
    default: return 'Could not review your code: ' + error;
  }
}

type FileName = 'code' | 'test' | 'readme';
type TabName = 'terminal' | 'problems' | 'output';

// VS Code-style mission editor. All UI is HTML/CSS, not an image.
export default function CodeWorkspace({ task, missionTitle, missionId }: Props) {
  const [code, setCode] = useState(task.starterCode);
  const [terminal, setTerminal] = useState(task.initialTerminal);
  const [file, setFile] = useState<FileName>('code');
  const [tab, setTab] = useState<TabName>('terminal');
  const [fullscreen, setFullscreen] = useState(false);
  const [passed, setPassed] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  // Start a new task when the player has a different role.
  useEffect(() => {
    setCode(task.starterCode);
    setTerminal(task.initialTerminal);
    setFile('code');
    setTab('terminal');
    setFullscreen(false);
    setPassed(false);
    setReviewing(false);
  }, [missionId, task.starterCode, task.initialTerminal]);

  const testName = task.testPreview.filename;
  const testCode = task.testPreview.content;

  let filename = task.filename;
  let content = code;
  let language = task.editorLanguage;

  if (file === 'test') {
    filename = testName;
    content = testCode;
    language = task.testPreview.language;
  }
  if (file === 'readme') {
    filename = 'README.md';
    content = '# ' + missionTitle + '\n\n' + task.description + '\n\nFix the code and press Run Tests.';
    language = 'markdown';
  }

  // Run Tests sends the code to the server, where Gemini decides PASS or FAIL.
  // The server then tells ALL players (mission:progress), so Team Progress stays in sync.
  // The editor is read-only while reviewing, so the result always matches the code on screen.
  function runTests() {
    if (reviewing) return;
    setTab('terminal');
    setReviewing(true);
    setTerminal('$ ai-review ' + task.filename + '\nReviewing your code with Gemini...');

    socket.timeout(REVIEW_TIMEOUT_MS).emit('challenge:submit', { code }, (err, res) => {
      setReviewing(false);
      if (err) {
        setTerminal('$ ai-review ' + task.filename + '\nServer did not respond. Press Run Tests to try again.');
        return;
      }
      if (!res.ok) {
        setTerminal('$ ai-review ' + task.filename + '\n' + reviewErrorText(res.error));
        return;
      }
      setTerminal(res.terminal); // PASS/FAIL + Gemini's explanation and hint
      setPassed(res.passed);
    });
  }

  return (
    <section className={'cr-ide' + (fullscreen ? ' cr-ide-fullscreen' : '')}>
      <div className="cr-ide-title">
        <strong><span className="cr-vs-logo">◇</span> CODE RED! — {task.title}</strong>
        <button
          type="button"
          className="cr-fullscreen-btn"
          onClick={() => setFullscreen(!fullscreen)}
          title={fullscreen ? 'Restore size' : 'Fullscreen'}
          aria-label={fullscreen ? 'Restore editor size' : 'Fullscreen editor'}
        >
          {fullscreen ? '⤢' : '⛶'}
        </button>
      </div>

      <div className="cr-ide-body">
        <div className="cr-activity-bar">
          <div title="Explorer">▤</div>
          <div title="Search">⌕</div>
          <div title="Source Control">⑂</div>
          <div title="Run and Debug">▷</div>
          <div className="cr-gear">⚙</div>
        </div>

        <aside className="cr-explorer">
          <div className="cr-explorer-heading">EXPLORER</div>
          <div className="cr-folder">⌄ {missionId}/</div>
          <div className="cr-folder cr-subfolder">⌄ src/</div>
          <button type="button" className={file === 'code' ? 'cr-selected' : ''} onClick={() => setFile('code')}>
            {task.filename}
          </button>
          <button type="button" className={file === 'test' ? 'cr-selected' : ''} onClick={() => setFile('test')}>
            {testName}
          </button>
          <button type="button" className={file === 'readme' ? 'cr-selected' : ''} onClick={() => setFile('readme')}>
            README.md
          </button>
        </aside>

        <div className="cr-editor-main">
          <div className="cr-editor-tab">
            <span>{filename}</span>
            {file !== 'code' && <small>READ ONLY</small>}
            {file === 'code' && reviewing && <small>LOCKED · REVIEWING</small>}
          </div>

          <div className="cr-monaco-box">
            <Editor
              key={missionId + '-' + file}
              height="100%"
              width="100%"
              theme="vs-dark"
              language={language}
              value={content}
              onChange={(value) => {
                if (file === 'code' && !reviewing) {
                  setCode(value || '');
                  setPassed(false);
                }
              }}
              options={{
                readOnly: file !== 'code' || reviewing,
                fontSize: 16,
                lineHeight: 23,
                minimap: { enabled: false },
                lineNumbers: 'on',
                wordWrap: 'on',
                automaticLayout: true,
                scrollBeyondLastLine: false
              }}
            />
          </div>

          <div className="cr-terminal-tabs">
            <button type="button" className={tab === 'terminal' ? 'cr-active' : ''} onClick={() => setTab('terminal')}>TERMINAL</button>
            <button type="button" className={tab === 'problems' ? 'cr-active' : ''} onClick={() => setTab('problems')}>PROBLEMS</button>
            <button type="button" className={tab === 'output' ? 'cr-active' : ''} onClick={() => setTab('output')}>OUTPUT</button>
            <button type="button" className="cr-run-btn" onClick={runTests} disabled={reviewing}>
              {reviewing ? 'Reviewing…' : '▶ Run Tests'}
            </button>
          </div>

          <div className="cr-terminal-output">
            {tab === 'terminal' && terminal.split('\n').map((line, i) => {
              let color = '';
              if (line.startsWith('FAIL')) color = 'cr-error';
              if (line.startsWith('PASS')) color = 'cr-success';
              if (line.startsWith('Hint:')) color = 'cr-hint';
              if (line.startsWith('$')) color = 'cr-command';
              return <div key={i} className={color}>{line || '\u00a0'}</div>;
            })}
            {tab === 'problems' && (passed ? 'No problems found by the AI review.' : 'Run Tests to see the current problem.')}
            {tab === 'output' && 'Run Tests sends your code to the server, where Gemini AI reviews it. Your code is never run.'}
          </div>

          <div className="cr-status-bar">
            <span>CODE RED!</span>
            <span>{filename} · Gemini AI review</span>
          </div>
        </div>
      </div>
    </section>
  );
}
