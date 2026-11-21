// Draws the preview data from print.js previewOf. Every value is rendered as React text, never as HTML,
// so whatever staff typed into a record shows literally.
const LINE = '1px solid #000';

export default function FormPreview({ model, maxWidth = 840 }) {
  const width = model.cols.reduce((a, b) => a + b, 0);
  const zoom = Math.min(1, maxWidth / width);
  return (
    <div style={{ zoom, position: 'relative', width, background: '#fff' }}>
      <table data-preview style={{ tableLayout: 'fixed', borderCollapse: 'collapse', width }}>
        <colgroup>
          {model.cols.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <tbody>
          {model.rows.map((row, r) => (
            <tr key={r} style={{ height: row.height }}>
              {row.cells.map((c) => (
                <td
                  key={c.col}
                  rowSpan={c.rowSpan}
                  colSpan={c.colSpan}
                  style={{
                    padding: '0 2px',
                    textAlign: c.align,
                    verticalAlign: c.valign,
                    whiteSpace: c.wrap ? 'pre-wrap' : 'pre',
                    overflow: 'visible',
                    borderTop: c.border.top ? LINE : undefined,
                    borderRight: c.border.right ? LINE : undefined,
                    borderBottom: c.border.bottom ? LINE : undefined,
                    borderLeft: c.border.left ? LINE : undefined,
                    color: '#000',
                    lineHeight: 1.1,
                  }}
                >
                  {c.runs.map((run, i) => (
                    <span
                      key={i}
                      style={{
                        fontFamily: `"${run.font}", Calibri, sans-serif`,
                        fontSize: `${run.size}pt`,
                        fontWeight: run.bold ? 700 : 400,
                        fontStyle: run.italic ? 'italic' : 'normal',
                        textDecoration: run.underline ? 'underline' : 'none',
                      }}
                    >
                      {run.text}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {model.image && (
        <img
          alt=""
          src={model.image.src}
          style={{ position: 'absolute', left: model.image.left, top: model.image.top, width: model.image.width, height: model.image.height }}
        />
      )}
    </div>
  );
}
