export interface GraphNode {
  addInput(label: string, type: string): void;
  addOutput(label: string, type: string): void;
  addWidget(
    type: string,
    name: string,
    value: string | null,
    callback: () => void,
  ): GraphWidget;
  bgcolor: string;
  color: string;
  connect(output: number, target: GraphNode | undefined, input: number): void;
  disconnectInput?(input: number): void;
  disconnectOutput?(output: number): void;
  entityId?: string;
  onSelected?: () => void;
  pos: [number, number];
  size: [number, number];
  title: string;
  widgets: GraphWidget[];
}

export interface GraphWidget {
  draw?: (
    context: CanvasRenderingContext2D,
    node: GraphNode,
    width: number,
    y: number,
    height: number,
  ) => void;
  type: string;
  value: string;
}

export interface LiteGraphModel {
  _nodes: GraphNode[];
  add(node: GraphNode): void;
  clear(): void;
  links?: Record<string, unknown>;
  remove?(node: GraphNode): void;
}

export interface LiteGraphCanvas {
  canvas: HTMLCanvasElement;
  ds: { offset: [number, number]; scale: number };
  getCanvasMenuOptions: () => null;
  getNodeMenuOptions: () => null;
  onNodeSelected: (node: GraphNode | null) => void;
  render_shadows: boolean;
  resize(): void;
  selectNode(node: GraphNode, addToSelection: boolean): void;
  setDirty(foreground: boolean, background: boolean): void;
  stopRendering?(): void;
}

interface GraphNodeConstructor {
  new(): GraphNode;
  readonly prototype: GraphNode;
  readonly title?: string;
  readonly title_text_color?: string;
}

export interface LiteGraphRuntime {
  LGraph: new () => LiteGraphModel;
  LGraphCanvas: new (canvas: HTMLCanvasElement, graph: LiteGraphModel) => LiteGraphCanvas;
  LGraphNode: GraphNodeConstructor;
  LiteGraph: {
    NODE_WIDGET_HEIGHT: number;
    createNode(type: string): GraphNode;
    registerNodeType(type: string, constructor: GraphNodeConstructor): void;
  };
}

export interface GraphNodeSpec {
  backgroundColor: string;
  color: string;
  id: string;
  onEnter?: () => void;
  position: [number, number];
  rows: string[];
  title: string;
  type: string;
}

interface WorldGraphControllerOptions {
  canvas: HTMLCanvasElement;
  onSelectionChange: (entityId: string) => void;
  runtime: LiteGraphRuntime;
  wrapper: HTMLElement;
}

const GRAPH_NODE_WIDTH = 240;
const GRAPH_MIN_FIT_SCALE = 0.65;
const GRAPH_WIDGET_HEIGHT = 24;
const registeredRuntimes = new WeakSet<LiteGraphRuntime['LiteGraph']>();

function registerNodes(runtime: LiteGraphRuntime, styles: Record<string, { titleColor: string }>): void {
  if (registeredRuntimes.has(runtime.LiteGraph)) return;
  registeredRuntimes.add(runtime.LiteGraph);
  for (const [kind, style] of Object.entries(styles)) {
    class EntityNode extends runtime.LGraphNode {
      static override readonly title = kind;
      static override readonly title_text_color = style.titleColor;

      constructor() {
        super();
        this.addInput('←', '');
        this.addOutput('→', '');
      }
    }
    runtime.LiteGraph.registerNodeType(`bunnyland/${kind}`, EntityNode);
  }
}

export class WorldGraphController {
  readonly canvas: LiteGraphCanvas;
  readonly graph: LiteGraphModel;
  readonly nodes: Record<string, GraphNode> = {};

  private readonly onResize = (): void => this.resize();
  private readonly runtime: LiteGraphRuntime;
  private readonly wrapper: HTMLElement;
  private selectedEntityId: string | null = null;

  constructor(
    { canvas, onSelectionChange, runtime, wrapper }: WorldGraphControllerOptions,
    styles: Record<string, { titleColor: string }>,
  ) {
    this.runtime = runtime;
    this.wrapper = wrapper;
    registerNodes(runtime, styles);
    this.graph = new runtime.LGraph();
    this.canvas = new runtime.LGraphCanvas(canvas, this.graph);
    this.canvas.render_shadows = false;
    this.canvas.getCanvasMenuOptions = () => null;
    this.canvas.getNodeMenuOptions = () => null;
    this.canvas.onNodeSelected = (node) => {
      if (node?.entityId) onSelectionChange(node.entityId);
    };
    runtime.LiteGraph.NODE_WIDGET_HEIGHT = GRAPH_WIDGET_HEIGHT;
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.canvas.stopRendering?.();
  }

  entityAt(clientX: number, clientY: number): string | null {
    const rect = this.canvas.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / this.canvas.ds.scale - this.canvas.ds.offset[0];
    const y = (clientY - rect.top) / this.canvas.ds.scale - this.canvas.ds.offset[1];
    const node = [...this.graph._nodes].reverse().find((item) => (
      item.entityId
      && x >= item.pos[0]
      && x <= item.pos[0] + item.size[0]
      && y >= item.pos[1] - 20
      && y <= item.pos[1] + item.size[1]
    ));
    return node?.entityId ?? null;
  }

  reconcile(specs: GraphNodeSpec[], edges: Array<[string, string]>, reset: boolean): void {
    const oldScale = this.canvas.ds.scale;
    const oldOffset: [number, number] = [...this.canvas.ds.offset];
    if (reset) {
      this.graph.clear();
      for (const id of Object.keys(this.nodes)) delete this.nodes[id];
    } else {
      const wanted = new Set(specs.map((spec) => spec.id));
      for (const [id, node] of Object.entries(this.nodes)) {
        if (!wanted.has(id)) {
          this.graph.remove?.(node);
          delete this.nodes[id];
        } else {
          node.disconnectOutput?.(0);
          node.disconnectInput?.(0);
        }
      }
    }

    for (const spec of specs) {
      let node = this.nodes[spec.id];
      const previousPosition: [number, number] | null = node ? [...node.pos] : null;
      if (!node) {
        node = this.runtime.LiteGraph.createNode(`bunnyland/${spec.type}`);
        this.graph.add(node);
        this.nodes[spec.id] = node;
      }
      node.widgets = [];
      node.title = spec.title;
      node.color = spec.color;
      node.bgcolor = spec.backgroundColor;
      node.entityId = spec.id;
      delete node.onSelected;
      for (const row of spec.rows) {
        const widget = node.addWidget('text', '', row, () => undefined);
        widget.type = 'label';
        widget.draw = function draw(context, _node, width, y, height): void {
          context.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--bl-text').trim();
          context.font = '12px "Courier New", monospace';
          context.fillText(this.value, 10, y + height * 0.7, width - 18);
        };
      }
      if (spec.onEnter) {
        node.addWidget(
          'button',
          spec.type === 'room' ? '🚪 Enter Room →' : '↳ Enter →',
          null,
          spec.onEnter,
        );
      }
      node.size = [
        GRAPH_NODE_WIDTH,
        38 + spec.rows.length * GRAPH_WIDGET_HEIGHT + (spec.onEnter ? 26 : 0),
      ];
      node.pos = !reset && previousPosition ? previousPosition : spec.position;
    }
    for (const [from, to] of edges) this.nodes[from]?.connect(0, this.nodes[to], 0);

    if (reset) {
      this.fit();
      return;
    }
    this.canvas.ds.scale = oldScale;
    this.canvas.ds.offset = oldOffset;
    if (this.selectedEntityId) {
      const selected = this.nodes[this.selectedEntityId];
      if (selected) this.canvas.selectNode(selected, false);
    }
    this.canvas.setDirty(true, true);
  }

  resize(): void {
    this.canvas.canvas.width = this.wrapper.clientWidth;
    this.canvas.canvas.height = this.wrapper.clientHeight;
    this.canvas.resize();
  }

  selectEntity(entityId: string): void {
    this.selectedEntityId = entityId;
    const node = this.nodes[entityId];
    if (node) this.canvas.selectNode(node, false);
  }

  private fit(): void {
    if (!this.graph._nodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.graph._nodes) {
      minX = Math.min(minX, node.pos[0]);
      minY = Math.min(minY, node.pos[1] - 20);
      maxX = Math.max(maxX, node.pos[0] + node.size[0]);
      maxY = Math.max(maxY, node.pos[1] + node.size[1]);
    }
    const margin = 60;
    const width = maxX - minX + 120;
    const height = maxY - minY + 120;
    const scale = Math.max(GRAPH_MIN_FIT_SCALE, Math.min(
      1,
      this.canvas.canvas.width / width,
      this.canvas.canvas.height / height,
    ));
    this.canvas.ds.scale = scale;
    this.canvas.ds.offset = [
      -minX + margin + (this.canvas.canvas.width / scale - width) / 2,
      -minY + margin + (this.canvas.canvas.height / scale - height) / 2,
    ];
    this.canvas.setDirty(true, true);
  }
}
