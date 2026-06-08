import { Handle, Position } from "@xyflow/react";

// One generic visual for all node kinds; the `data` summary differentiates them.
function Shell({ data, hasIn, hasOut }) {
  const { icon, title, status, lines, chips } = data;
  return (
    <div className={"node" + (data.selected ? " sel" : "")} onClick={data.onOpen}>
      {hasIn && <Handle type="target" position={Position.Left} />}
      <div className="head">
        <span className="ic">{icon}</span>
        <span className="ttl">{title}</span>
        <span className={"dot " + (status || "")} />
      </div>
      <div className="body">
        {(lines || []).map((l, i) => (
          <div key={i} className={l.metric ? "metric" : ""}>{l.text}</div>
        ))}
        {chips && chips.length > 0 && (
          <div className="chips">
            {chips.slice(0, 6).map((c, i) => (
              <span key={i} className={"chip" + (c.role ? " role" : "")}>{c.label}</span>
            ))}
            {chips.length > 6 && <span className="chip">+{chips.length - 6}</span>}
          </div>
        )}
      </div>
      {hasOut && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

export const TriggerNode = (p) => <Shell {...p} hasOut />;
export const SourceNode = (p) => <Shell {...p} hasIn hasOut />;
export const MapNode = (p) => <Shell {...p} hasIn hasOut />;
export const FilterNode = (p) => <Shell {...p} hasIn hasOut />;
export const DatabaseNode = (p) => <Shell {...p} hasIn />;

export const nodeTypes = {
  trigger: TriggerNode,
  source: SourceNode,
  map: MapNode,
  filter: FilterNode,
  database: DatabaseNode,
};
