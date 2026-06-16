// entities.js — typed-entity registry (the Maltego-style ontology).
// Pure data + lookup helpers, no app state. Loaded BEFORE app.js so the editor
// (normalizeNode, createNodeAt, the palette, the property editor and the renderer)
// is driven by entity types instead of bare geometry.
//
// The catalog below spans OSINT/identity/network plus program & data-flow (UML,
// flowchart, DFD) and cloud environments (compute, storage, networking, Kubernetes,
// IAM/security, DevOps, observability). It is largely generated; to add a type,
// append an entry to TYPE_LIST with {id, name, category, color, shape, icon,
// valuePattern?, properties:[{key,label,type}]}.
(function (global) {
    "use strict";

    // shape must be one of: circle, rect, rounded, diamond, cylinder, swimlane.
    const TYPE_LIST = [
    {
        "id": "generic",
        "name": "Entity",
        "category": "General",
        "color": "#4682b4",
        "shape": "circle",
        "icon": "",
        "properties": []
    },
    {
        "id": "person",
        "name": "Person",
        "category": "Identity",
        "color": "#e15759",
        "shape": "circle",
        "icon": "👤",
        "properties": [
            {
                "key": "fullname",
                "label": "Full name",
                "type": "string"
            },
            {
                "key": "email",
                "label": "Email",
                "type": "string"
            },
            {
                "key": "role",
                "label": "Role",
                "type": "string"
            }
        ]
    },
    {
        "id": "email",
        "name": "Email Address",
        "category": "Identity",
        "color": "#f28e2b",
        "shape": "circle",
        "icon": "✉️",
        "valuePattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
        "properties": [
            {
                "key": "displayName",
                "label": "Display name",
                "type": "string"
            }
        ]
    },
    {
        "id": "organization",
        "name": "Organization",
        "category": "Identity",
        "color": "#b07aa1",
        "shape": "rounded",
        "icon": "🏢",
        "properties": [
            {
                "key": "domain",
                "label": "Domain",
                "type": "string"
            },
            {
                "key": "country",
                "label": "Country",
                "type": "string"
            }
        ]
    },
    {
        "id": "phone",
        "name": "Phone Number",
        "category": "Identity",
        "color": "#9c755f",
        "shape": "circle",
        "icon": "📞",
        "properties": [
            {
                "key": "country",
                "label": "Country",
                "type": "string"
            }
        ]
    },
    {
        "id": "domain",
        "name": "Domain",
        "category": "Network",
        "color": "#59a14f",
        "shape": "circle",
        "icon": "🌐",
        "valuePattern": "^([a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,}$",
        "properties": [
            {
                "key": "registrar",
                "label": "Registrar",
                "type": "string"
            }
        ]
    },
    {
        "id": "url",
        "name": "URL",
        "category": "Network",
        "color": "#76b7b2",
        "shape": "rounded",
        "icon": "🔗",
        "valuePattern": "^https?://",
        "properties": [
            {
                "key": "status",
                "label": "HTTP status",
                "type": "number"
            }
        ]
    },
    {
        "id": "ipv4",
        "name": "IPv4 Address",
        "category": "Network",
        "color": "#4e79a7",
        "shape": "rect",
        "icon": "📡",
        "valuePattern": "^(\\d{1,3}\\.){3}\\d{1,3}$",
        "properties": [
            {
                "key": "asn",
                "label": "ASN",
                "type": "string"
            },
            {
                "key": "geo",
                "label": "Geo",
                "type": "string"
            }
        ]
    },
    {
        "id": "port",
        "name": "Network Port",
        "category": "Network",
        "color": "#8cd17d",
        "shape": "circle",
        "icon": "🔌",
        "properties": [
            {
                "key": "service",
                "label": "Service",
                "type": "string"
            },
            {
                "key": "protocol",
                "label": "Protocol",
                "type": "string"
            }
        ]
    },
    {
        "id": "host",
        "name": "Host / Server",
        "category": "Infrastructure",
        "color": "#4f8bc9",
        "shape": "cylinder",
        "icon": "🖥️",
        "properties": [
            {
                "key": "os",
                "label": "Operating system",
                "type": "string"
            },
            {
                "key": "ip",
                "label": "IP",
                "type": "string"
            }
        ]
    },
    {
        "id": "device",
        "name": "Device",
        "category": "Infrastructure",
        "color": "#5cab7d",
        "shape": "rect",
        "icon": "💻",
        "properties": [
            {
                "key": "type",
                "label": "Type",
                "type": "string"
            }
        ]
    },
    {
        "id": "file",
        "name": "File / Document",
        "category": "Infrastructure",
        "color": "#edc948",
        "shape": "rect",
        "icon": "📄",
        "properties": [
            {
                "key": "hash",
                "label": "Hash",
                "type": "string"
            },
            {
                "key": "size",
                "label": "Size",
                "type": "string"
            }
        ]
    },
    {
        "id": "location",
        "name": "Location",
        "category": "Geo",
        "color": "#ff9da7",
        "shape": "circle",
        "icon": "📍",
        "properties": [
            {
                "key": "lat",
                "label": "Latitude",
                "type": "number"
            },
            {
                "key": "lng",
                "label": "Longitude",
                "type": "number"
            },
            {
                "key": "address",
                "label": "Address",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlClass",
        "name": "UML Class",
        "category": "UML · Structural",
        "color": "#4e79a7",
        "shape": "rect",
        "icon": "▦",
        "properties": [
            {
                "key": "stereotype",
                "label": "Stereotype",
                "type": "string"
            },
            {
                "key": "attributes",
                "label": "Attributes",
                "type": "string"
            },
            {
                "key": "operations",
                "label": "Operations",
                "type": "string"
            },
            {
                "key": "visibility",
                "label": "Visibility",
                "type": "string"
            },
            {
                "key": "namespace",
                "label": "Namespace / Package",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlAbstractClass",
        "name": "UML Abstract Class",
        "category": "UML · Structural",
        "color": "#5b8cb8",
        "shape": "rect",
        "icon": "𝒜",
        "properties": [
            {
                "key": "abstractOperations",
                "label": "Abstract operations",
                "type": "string"
            },
            {
                "key": "attributes",
                "label": "Attributes",
                "type": "string"
            },
            {
                "key": "namespace",
                "label": "Namespace / Package",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlInterface",
        "name": "UML Interface",
        "category": "UML · Structural",
        "color": "#76b7b2",
        "shape": "rect",
        "icon": "◯",
        "properties": [
            {
                "key": "stereotype",
                "label": "Stereotype",
                "type": "string"
            },
            {
                "key": "operations",
                "label": "Operations",
                "type": "string"
            },
            {
                "key": "namespace",
                "label": "Namespace / Package",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlEnumeration",
        "name": "UML Enumeration",
        "category": "UML · Structural",
        "color": "#8cd17d",
        "shape": "rect",
        "icon": "≣",
        "properties": [
            {
                "key": "literals",
                "label": "Literals",
                "type": "string"
            },
            {
                "key": "count",
                "label": "Literal count",
                "type": "number"
            },
            {
                "key": "namespace",
                "label": "Namespace / Package",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlDataType",
        "name": "UML DataType",
        "category": "UML · Structural",
        "color": "#9dc97a",
        "shape": "rect",
        "icon": "ⓣ",
        "properties": [
            {
                "key": "kind",
                "label": "Kind (primitive/struct)",
                "type": "string"
            },
            {
                "key": "attributes",
                "label": "Attributes",
                "type": "string"
            },
            {
                "key": "namespace",
                "label": "Namespace / Package",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlPrimitiveType",
        "name": "UML Primitive Type",
        "category": "UML · Structural",
        "color": "#a0cfac",
        "shape": "rect",
        "icon": "ⓟ",
        "properties": [
            {
                "key": "baseType",
                "label": "Base type",
                "type": "string"
            },
            {
                "key": "namespace",
                "label": "Namespace / Package",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlObject",
        "name": "UML Object / Instance",
        "category": "UML · Structural",
        "color": "#f28e2b",
        "shape": "rounded",
        "icon": "◉",
        "properties": [
            {
                "key": "classifier",
                "label": "Classifier (type)",
                "type": "string"
            },
            {
                "key": "slots",
                "label": "Slot values",
                "type": "string"
            },
            {
                "key": "instanceName",
                "label": "Instance name",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlPackage",
        "name": "UML Package",
        "category": "UML · Structural",
        "color": "#b07aa1",
        "shape": "rounded",
        "icon": "🗂",
        "properties": [
            {
                "key": "qualifiedName",
                "label": "Qualified name",
                "type": "string"
            },
            {
                "key": "visibility",
                "label": "Visibility",
                "type": "string"
            },
            {
                "key": "elementCount",
                "label": "Contained elements",
                "type": "number"
            }
        ]
    },
    {
        "id": "umlModel",
        "name": "UML Model",
        "category": "UML · Structural",
        "color": "#c290b4",
        "shape": "rounded",
        "icon": "🧱",
        "properties": [
            {
                "key": "viewpoint",
                "label": "Viewpoint",
                "type": "string"
            },
            {
                "key": "version",
                "label": "Version",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlSubsystem",
        "name": "UML Subsystem",
        "category": "UML · Structural",
        "color": "#9b6fb0",
        "shape": "rounded",
        "icon": "🧩",
        "properties": [
            {
                "key": "stereotype",
                "label": "Stereotype",
                "type": "string"
            },
            {
                "key": "responsibility",
                "label": "Responsibility",
                "type": "string"
            },
            {
                "key": "version",
                "label": "Version",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlComponent",
        "name": "UML Component",
        "category": "UML · Structural",
        "color": "#e15759",
        "shape": "rect",
        "icon": "⬢",
        "properties": [
            {
                "key": "stereotype",
                "label": "Stereotype",
                "type": "string"
            },
            {
                "key": "provided",
                "label": "Provided interfaces",
                "type": "string"
            },
            {
                "key": "required",
                "label": "Required interfaces",
                "type": "string"
            },
            {
                "key": "version",
                "label": "Version",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlPort",
        "name": "UML Port",
        "category": "UML · Structural",
        "color": "#ff9d9a",
        "shape": "rect",
        "icon": "🚪",
        "properties": [
            {
                "key": "direction",
                "label": "Direction (in/out/inout)",
                "type": "string"
            },
            {
                "key": "interfaceType",
                "label": "Interface type",
                "type": "string"
            },
            {
                "key": "multiplicity",
                "label": "Multiplicity",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlProvidedInterface",
        "name": "Provided Interface (Lollipop)",
        "category": "UML · Structural",
        "color": "#59a14f",
        "shape": "circle",
        "icon": "🍭",
        "properties": [
            {
                "key": "interfaceName",
                "label": "Interface name",
                "type": "string"
            },
            {
                "key": "operations",
                "label": "Operations",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlRequiredInterface",
        "name": "Required Interface (Socket)",
        "category": "UML · Structural",
        "color": "#8cd17d",
        "shape": "circle",
        "icon": "◗",
        "properties": [
            {
                "key": "interfaceName",
                "label": "Interface name",
                "type": "string"
            },
            {
                "key": "operations",
                "label": "Operations",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlArtifact",
        "name": "UML Artifact",
        "category": "UML · Structural",
        "color": "#edc948",
        "shape": "rect",
        "icon": "📦",
        "properties": [
            {
                "key": "stereotype",
                "label": "Stereotype (jar/exe/file)",
                "type": "string"
            },
            {
                "key": "fileName",
                "label": "File name",
                "type": "string"
            },
            {
                "key": "version",
                "label": "Version",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlManifestation",
        "name": "UML Manifestation Artifact",
        "category": "UML · Structural",
        "color": "#dcb83f",
        "shape": "rect",
        "icon": "📜",
        "properties": [
            {
                "key": "manifests",
                "label": "Manifested component",
                "type": "string"
            },
            {
                "key": "fileName",
                "label": "File name",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlDeploymentNode",
        "name": "UML Deployment Node",
        "category": "UML · Structural",
        "color": "#4f8bc9",
        "shape": "rect",
        "icon": "🖳",
        "properties": [
            {
                "key": "stereotype",
                "label": "Stereotype (device/server)",
                "type": "string"
            },
            {
                "key": "os",
                "label": "Operating system",
                "type": "string"
            },
            {
                "key": "hardware",
                "label": "Hardware spec",
                "type": "string"
            },
            {
                "key": "nodeKind",
                "label": "Node kind",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlExecutionEnvironment",
        "name": "UML Execution Environment",
        "category": "UML · Structural",
        "color": "#6aa3d6",
        "shape": "rounded",
        "icon": "⚙",
        "properties": [
            {
                "key": "runtime",
                "label": "Runtime (JVM/CLR/Node)",
                "type": "string"
            },
            {
                "key": "version",
                "label": "Version",
                "type": "string"
            },
            {
                "key": "host",
                "label": "Host node",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlDevice",
        "name": "UML Device Node",
        "category": "UML · Structural",
        "color": "#3f7cb5",
        "shape": "rect",
        "icon": "🖧",
        "properties": [
            {
                "key": "deviceType",
                "label": "Device type",
                "type": "string"
            },
            {
                "key": "vendor",
                "label": "Vendor",
                "type": "string"
            },
            {
                "key": "specs",
                "label": "Specs",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlSignal",
        "name": "UML Signal",
        "category": "UML · Structural",
        "color": "#f1ce63",
        "shape": "rect",
        "icon": "⚡",
        "properties": [
            {
                "key": "attributes",
                "label": "Attributes / payload",
                "type": "string"
            },
            {
                "key": "namespace",
                "label": "Namespace / Package",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlNote",
        "name": "UML Note / Comment",
        "category": "UML · Structural",
        "color": "#bab0ac",
        "shape": "rect",
        "icon": "📝",
        "properties": [
            {
                "key": "text",
                "label": "Text",
                "type": "string"
            },
            {
                "key": "annotates",
                "label": "Annotated element",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlConstraint",
        "name": "UML Constraint",
        "category": "UML · Structural",
        "color": "#9b9489",
        "shape": "rounded",
        "icon": "⛓",
        "properties": [
            {
                "key": "expression",
                "label": "Expression (OCL)",
                "type": "string"
            },
            {
                "key": "context",
                "label": "Context element",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlAssociationClass",
        "name": "UML Association Class",
        "category": "UML · Structural",
        "color": "#6b8fb8",
        "shape": "rect",
        "icon": "⬓",
        "properties": [
            {
                "key": "attributes",
                "label": "Attributes",
                "type": "string"
            },
            {
                "key": "endpoints",
                "label": "Associated classes",
                "type": "string"
            },
            {
                "key": "namespace",
                "label": "Namespace / Package",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlProfile",
        "name": "UML Profile / Stereotype Def",
        "category": "UML · Structural",
        "color": "#c79bba",
        "shape": "rounded",
        "icon": "🏷",
        "properties": [
            {
                "key": "stereotypes",
                "label": "Stereotypes defined",
                "type": "string"
            },
            {
                "key": "metaclass",
                "label": "Extended metaclass",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlReception",
        "name": "UML Reception",
        "category": "UML · Structural",
        "color": "#f4d35e",
        "shape": "rect",
        "icon": "📥",
        "properties": [
            {
                "key": "signal",
                "label": "Handled signal",
                "type": "string"
            },
            {
                "key": "owner",
                "label": "Owning classifier",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlActor",
        "name": "Actor",
        "category": "UML · Behavioral",
        "color": "#4e79a7",
        "shape": "circle",
        "icon": "👤",
        "properties": [
            {
                "key": "role",
                "label": "Role",
                "type": "string"
            },
            {
                "key": "kind",
                "label": "Kind (human/system)",
                "type": "string"
            },
            {
                "key": "description",
                "label": "Description",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlUseCase",
        "name": "Use Case",
        "category": "UML · Behavioral",
        "color": "#6b93c2",
        "shape": "rounded",
        "icon": "⬭",
        "properties": [
            {
                "key": "goal",
                "label": "Goal",
                "type": "string"
            },
            {
                "key": "preconditions",
                "label": "Preconditions",
                "type": "string"
            },
            {
                "key": "priority",
                "label": "Priority",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlSystemBoundary",
        "name": "System Boundary",
        "category": "UML · Behavioral",
        "color": "#a0b9d8",
        "shape": "rounded",
        "icon": "🗂️",
        "properties": [
            {
                "key": "system",
                "label": "System name",
                "type": "string"
            },
            {
                "key": "scope",
                "label": "Scope",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlStart",
        "name": "Start / Initial Node",
        "category": "UML · Behavioral",
        "color": "#59a14f",
        "shape": "circle",
        "icon": "▶",
        "properties": [
            {
                "key": "trigger",
                "label": "Trigger",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlEnd",
        "name": "End / Final Node",
        "category": "UML · Behavioral",
        "color": "#e15759",
        "shape": "circle",
        "icon": "⏹",
        "properties": [
            {
                "key": "outcome",
                "label": "Outcome",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlFlowFinal",
        "name": "Flow Final",
        "category": "UML · Behavioral",
        "color": "#c44e4f",
        "shape": "circle",
        "icon": "⊗",
        "properties": [
            {
                "key": "note",
                "label": "Note",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlAction",
        "name": "Action / Process",
        "category": "UML · Behavioral",
        "color": "#f28e2b",
        "shape": "rounded",
        "icon": "⚙️",
        "properties": [
            {
                "key": "operation",
                "label": "Operation",
                "type": "string"
            },
            {
                "key": "owner",
                "label": "Owner",
                "type": "string"
            },
            {
                "key": "duration",
                "label": "Duration (ms)",
                "type": "number"
            }
        ]
    },
    {
        "id": "umlDecision",
        "name": "Decision / Branch",
        "category": "UML · Behavioral",
        "color": "#edc948",
        "shape": "diamond",
        "icon": "❓",
        "properties": [
            {
                "key": "condition",
                "label": "Condition",
                "type": "string"
            },
            {
                "key": "defaultBranch",
                "label": "Default branch",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlMerge",
        "name": "Merge",
        "category": "UML · Behavioral",
        "color": "#d4b94a",
        "shape": "diamond",
        "icon": "▽",
        "properties": [
            {
                "key": "note",
                "label": "Note",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlForkJoin",
        "name": "Fork / Join",
        "category": "UML · Behavioral",
        "color": "#b07aa1",
        "shape": "rect",
        "icon": "🔀",
        "properties": [
            {
                "key": "mode",
                "label": "Mode (fork/join)",
                "type": "string"
            },
            {
                "key": "branches",
                "label": "Branch count",
                "type": "number"
            }
        ]
    },
    {
        "id": "umlSwimlane",
        "name": "Swimlane / Partition",
        "category": "UML · Behavioral",
        "color": "#f2c94c",
        "shape": "swimlane",
        "icon": "🏊",
        "properties": [
            {
                "key": "actor",
                "label": "Actor / Role",
                "type": "string"
            },
            {
                "key": "orientation",
                "label": "Orientation",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlObjectNode",
        "name": "Object / Data Node",
        "category": "UML · Behavioral",
        "color": "#f1a73e",
        "shape": "rect",
        "icon": "📦",
        "properties": [
            {
                "key": "dataType",
                "label": "Data type",
                "type": "string"
            },
            {
                "key": "state",
                "label": "State",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlState",
        "name": "State",
        "category": "UML · Behavioral",
        "color": "#76b7b2",
        "shape": "rounded",
        "icon": "◻",
        "properties": [
            {
                "key": "entryAction",
                "label": "Entry action",
                "type": "string"
            },
            {
                "key": "exitAction",
                "label": "Exit action",
                "type": "string"
            },
            {
                "key": "doActivity",
                "label": "Do activity",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlInitialState",
        "name": "Initial State",
        "category": "UML · Behavioral",
        "color": "#4e9b4a",
        "shape": "circle",
        "icon": "●",
        "properties": [
            {
                "key": "note",
                "label": "Note",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlFinalState",
        "name": "Final State",
        "category": "UML · Behavioral",
        "color": "#d14546",
        "shape": "circle",
        "icon": "◉",
        "properties": [
            {
                "key": "note",
                "label": "Note",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlCompositeState",
        "name": "Composite State",
        "category": "UML · Behavioral",
        "color": "#5aa39e",
        "shape": "rounded",
        "icon": "⊞",
        "properties": [
            {
                "key": "substates",
                "label": "Substate count",
                "type": "number"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlChoicePseudostate",
        "name": "Choice Pseudostate",
        "category": "UML · Behavioral",
        "color": "#d6b43f",
        "shape": "diamond",
        "icon": "◈",
        "properties": [
            {
                "key": "guard",
                "label": "Guard",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlLifeline",
        "name": "Lifeline / Participant",
        "category": "UML · Behavioral",
        "color": "#9c755f",
        "shape": "rect",
        "icon": "🧍",
        "properties": [
            {
                "key": "instanceName",
                "label": "Instance name",
                "type": "string"
            },
            {
                "key": "className",
                "label": "Class / Type",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlActivation",
        "name": "Activation / Execution",
        "category": "UML · Behavioral",
        "color": "#b094a7",
        "shape": "rect",
        "icon": "▮",
        "properties": [
            {
                "key": "method",
                "label": "Method",
                "type": "string"
            },
            {
                "key": "duration",
                "label": "Duration (ms)",
                "type": "number"
            }
        ]
    },
    {
        "id": "umlSeqFragment",
        "name": "Combined Fragment",
        "category": "UML · Behavioral",
        "color": "#8a6d99",
        "shape": "rounded",
        "icon": "⧉",
        "properties": [
            {
                "key": "operator",
                "label": "Operator (alt/opt/loop)",
                "type": "string"
            },
            {
                "key": "guard",
                "label": "Guard",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlSendSignal",
        "name": "Send Signal Action",
        "category": "UML · Behavioral",
        "color": "#f1ce63",
        "shape": "rect",
        "icon": "📤",
        "properties": [
            {
                "key": "signal",
                "label": "Signal",
                "type": "string"
            },
            {
                "key": "target",
                "label": "Target",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlAcceptEvent",
        "name": "Accept Event Action",
        "category": "UML · Behavioral",
        "color": "#f0d77a",
        "shape": "rect",
        "icon": "📩",
        "properties": [
            {
                "key": "event",
                "label": "Event",
                "type": "string"
            },
            {
                "key": "isTimeEvent",
                "label": "Time event (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlTimeEvent",
        "name": "Time / Wait Event",
        "category": "UML · Behavioral",
        "color": "#d4b94a",
        "shape": "rounded",
        "icon": "⏳",
        "properties": [
            {
                "key": "when",
                "label": "When / Duration",
                "type": "string"
            },
            {
                "key": "relative",
                "label": "Relative (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlCallBehavior",
        "name": "Call Behavior Action",
        "category": "UML · Behavioral",
        "color": "#e8a13e",
        "shape": "rounded",
        "icon": "📞",
        "properties": [
            {
                "key": "behavior",
                "label": "Invoked behavior",
                "type": "string"
            },
            {
                "key": "synchronous",
                "label": "Synchronous (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlPin",
        "name": "Input / Output Pin",
        "category": "UML · Behavioral",
        "color": "#f2b56b",
        "shape": "rect",
        "icon": "📌",
        "properties": [
            {
                "key": "direction",
                "label": "Direction (in/out)",
                "type": "string"
            },
            {
                "key": "dataType",
                "label": "Data type",
                "type": "string"
            },
            {
                "key": "multiplicity",
                "label": "Multiplicity",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlHistoryPseudostate",
        "name": "History Pseudostate",
        "category": "UML · Behavioral",
        "color": "#5aa39e",
        "shape": "circle",
        "icon": "Ⓗ",
        "properties": [
            {
                "key": "kind",
                "label": "Kind (shallow/deep)",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlJunctionPseudostate",
        "name": "Junction Pseudostate",
        "category": "UML · Behavioral",
        "color": "#4f8f8a",
        "shape": "circle",
        "icon": "◍",
        "properties": [
            {
                "key": "guard",
                "label": "Guard",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlEntryExitPoint",
        "name": "Entry / Exit Point",
        "category": "UML · Behavioral",
        "color": "#6aa6a1",
        "shape": "circle",
        "icon": "⊙",
        "properties": [
            {
                "key": "kind",
                "label": "Kind (entry/exit)",
                "type": "string"
            },
            {
                "key": "state",
                "label": "Owning state",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlInteractionUse",
        "name": "Interaction Use (ref)",
        "category": "UML · Behavioral",
        "color": "#8a6d99",
        "shape": "rounded",
        "icon": "⤵",
        "properties": [
            {
                "key": "refName",
                "label": "Referenced interaction",
                "type": "string"
            },
            {
                "key": "arguments",
                "label": "Arguments",
                "type": "string"
            }
        ]
    },
    {
        "id": "umlGate",
        "name": "Sequence Gate",
        "category": "UML · Behavioral",
        "color": "#9a7da9",
        "shape": "circle",
        "icon": "◎",
        "properties": [
            {
                "key": "gateName",
                "label": "Gate name",
                "type": "string"
            },
            {
                "key": "direction",
                "label": "Direction (in/out)",
                "type": "string"
            }
        ]
    },
    {
        "id": "dfdExternalEntity",
        "name": "External Entity",
        "category": "Data Flow",
        "color": "#4f8bc9",
        "shape": "rect",
        "icon": "🚪",
        "properties": [
            {
                "key": "actorType",
                "label": "Actor type",
                "type": "string"
            },
            {
                "key": "trustLevel",
                "label": "Trust level",
                "type": "string"
            }
        ]
    },
    {
        "id": "dfdProcess",
        "name": "DFD Process",
        "category": "Data Flow",
        "color": "#f28e2b",
        "shape": "circle",
        "icon": "⚡",
        "properties": [
            {
                "key": "processId",
                "label": "Process ID",
                "type": "string"
            },
            {
                "key": "function",
                "label": "Function",
                "type": "string"
            },
            {
                "key": "owner",
                "label": "Owner",
                "type": "string"
            }
        ]
    },
    {
        "id": "dfdDataStore",
        "name": "Data Store",
        "category": "Data Flow",
        "color": "#4e79a7",
        "shape": "cylinder",
        "icon": "🗄️",
        "properties": [
            {
                "key": "storeId",
                "label": "Store ID",
                "type": "string"
            },
            {
                "key": "medium",
                "label": "Medium",
                "type": "string"
            },
            {
                "key": "classification",
                "label": "Data classification",
                "type": "string"
            }
        ]
    },
    {
        "id": "dfdTrustBoundary",
        "name": "Trust Boundary",
        "category": "Data Flow",
        "color": "#e15759",
        "shape": "rounded",
        "icon": "🛡️",
        "properties": [
            {
                "key": "boundaryName",
                "label": "Boundary name",
                "type": "string"
            },
            {
                "key": "trustDirection",
                "label": "Trust direction",
                "type": "string"
            },
            {
                "key": "controls",
                "label": "Controls",
                "type": "string"
            }
        ]
    },
    {
        "id": "dfdDataFlowLabel",
        "name": "Data Flow Endpoint",
        "category": "Data Flow",
        "color": "#76b7b2",
        "shape": "rounded",
        "icon": "🔁",
        "properties": [
            {
                "key": "payload",
                "label": "Payload",
                "type": "string"
            },
            {
                "key": "protocol",
                "label": "Protocol",
                "type": "string"
            }
        ]
    },
    {
        "id": "dfdTerminator",
        "name": "DFD Source / Sink",
        "category": "Data Flow",
        "color": "#6a9fd0",
        "shape": "rect",
        "icon": "⏏",
        "properties": [
            {
                "key": "role",
                "label": "Role (source/sink)",
                "type": "string"
            },
            {
                "key": "external",
                "label": "External (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "dfdMultiProcess",
        "name": "Multi-Process (Subsystem)",
        "category": "Data Flow",
        "color": "#f5a45c",
        "shape": "circle",
        "icon": "⊚",
        "properties": [
            {
                "key": "level",
                "label": "DFD level",
                "type": "number"
            },
            {
                "key": "decomposes",
                "label": "Decomposes to",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowStartEnd",
        "name": "Terminator (Start/End)",
        "category": "Data Flow",
        "color": "#59a14f",
        "shape": "rounded",
        "icon": "⏻",
        "properties": [
            {
                "key": "label",
                "label": "Label",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowProcess",
        "name": "Process Step",
        "category": "Data Flow",
        "color": "#e8902a",
        "shape": "rect",
        "icon": "▭",
        "properties": [
            {
                "key": "action",
                "label": "Action",
                "type": "string"
            },
            {
                "key": "step",
                "label": "Step number",
                "type": "number"
            }
        ]
    },
    {
        "id": "flowDecision",
        "name": "Decision",
        "category": "Data Flow",
        "color": "#edc948",
        "shape": "diamond",
        "icon": "◆",
        "properties": [
            {
                "key": "question",
                "label": "Question",
                "type": "string"
            },
            {
                "key": "yesBranch",
                "label": "Yes branch",
                "type": "string"
            },
            {
                "key": "noBranch",
                "label": "No branch",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowInputOutput",
        "name": "Input / Output",
        "category": "Data Flow",
        "color": "#b07aa1",
        "shape": "rect",
        "icon": "⌨",
        "properties": [
            {
                "key": "ioType",
                "label": "I/O type",
                "type": "string"
            },
            {
                "key": "source",
                "label": "Source / Sink",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowPredefinedProcess",
        "name": "Predefined Process",
        "category": "Data Flow",
        "color": "#d98324",
        "shape": "rect",
        "icon": "🧩",
        "properties": [
            {
                "key": "subroutine",
                "label": "Subroutine name",
                "type": "string"
            },
            {
                "key": "module",
                "label": "Module",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowDocument",
        "name": "Document",
        "category": "Data Flow",
        "color": "#9c755f",
        "shape": "rect",
        "icon": "📄",
        "properties": [
            {
                "key": "docName",
                "label": "Document name",
                "type": "string"
            },
            {
                "key": "format",
                "label": "Format",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowDataStore",
        "name": "Stored Data",
        "category": "Data Flow",
        "color": "#3f6fb5",
        "shape": "cylinder",
        "icon": "💾",
        "properties": [
            {
                "key": "storeName",
                "label": "Store name",
                "type": "string"
            },
            {
                "key": "kind",
                "label": "Kind",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowConnector",
        "name": "Connector / Off-page",
        "category": "Data Flow",
        "color": "#8cd17d",
        "shape": "circle",
        "icon": "🔗",
        "properties": [
            {
                "key": "ref",
                "label": "Reference label",
                "type": "string"
            },
            {
                "key": "page",
                "label": "Page",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowAnnotation",
        "name": "Annotation / Comment",
        "category": "Data Flow",
        "color": "#bab0ac",
        "shape": "rect",
        "icon": "🗒",
        "properties": [
            {
                "key": "text",
                "label": "Text",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowManualOperation",
        "name": "Manual Operation",
        "category": "Data Flow",
        "color": "#c98a4b",
        "shape": "rect",
        "icon": "✍",
        "properties": [
            {
                "key": "action",
                "label": "Action",
                "type": "string"
            },
            {
                "key": "operator",
                "label": "Operator",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowDelay",
        "name": "Delay / Wait",
        "category": "Data Flow",
        "color": "#d9b06b",
        "shape": "rounded",
        "icon": "⏲",
        "properties": [
            {
                "key": "duration",
                "label": "Duration",
                "type": "string"
            },
            {
                "key": "reason",
                "label": "Reason",
                "type": "string"
            }
        ]
    },
    {
        "id": "flowMerge",
        "name": "Merge / Collate",
        "category": "Data Flow",
        "color": "#e0c060",
        "shape": "diamond",
        "icon": "⨯",
        "properties": [
            {
                "key": "inputs",
                "label": "Input count",
                "type": "number"
            }
        ]
    },
    {
        "id": "flowLoopLimit",
        "name": "Loop Limit",
        "category": "Data Flow",
        "color": "#cfa24a",
        "shape": "rounded",
        "icon": "🔁",
        "properties": [
            {
                "key": "condition",
                "label": "Loop condition",
                "type": "string"
            },
            {
                "key": "maxIterations",
                "label": "Max iterations",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudFunction",
        "name": "Serverless Function (Lambda)",
        "category": "Cloud · Compute",
        "color": "#ec912d",
        "shape": "rounded",
        "icon": "λ",
        "properties": [
            {
                "key": "runtime",
                "label": "Runtime",
                "type": "string"
            },
            {
                "key": "memoryMb",
                "label": "Memory (MB)",
                "type": "number"
            },
            {
                "key": "timeoutSec",
                "label": "Timeout (s)",
                "type": "number"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "trigger",
                "label": "Trigger",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudEdgeFunction",
        "name": "Edge Function (CloudFront/Workers)",
        "category": "Cloud · Compute",
        "color": "#f2a93b",
        "shape": "rounded",
        "icon": "⚡",
        "properties": [
            {
                "key": "runtime",
                "label": "Runtime",
                "type": "string"
            },
            {
                "key": "provider",
                "label": "Provider",
                "type": "string"
            },
            {
                "key": "pop",
                "label": "Edge location/PoP",
                "type": "string"
            },
            {
                "key": "trigger",
                "label": "Trigger event",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudInstance",
        "name": "VM / Instance (EC2)",
        "category": "Cloud · Compute",
        "color": "#e07b1f",
        "shape": "rect",
        "icon": "🖥️",
        "properties": [
            {
                "key": "instanceType",
                "label": "Instance type",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "az",
                "label": "Availability zone",
                "type": "string"
            },
            {
                "key": "os",
                "label": "OS / AMI",
                "type": "string"
            },
            {
                "key": "publicIp",
                "label": "Public IP",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudAutoScalingGroup",
        "name": "Auto-Scaling Group",
        "category": "Cloud · Compute",
        "color": "#c96a17",
        "shape": "rounded",
        "icon": "⬢",
        "properties": [
            {
                "key": "minSize",
                "label": "Min size",
                "type": "number"
            },
            {
                "key": "maxSize",
                "label": "Max size",
                "type": "number"
            },
            {
                "key": "desiredCapacity",
                "label": "Desired capacity",
                "type": "number"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "scalingPolicy",
                "label": "Scaling policy",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudContainer",
        "name": "Container",
        "category": "Cloud · Compute",
        "color": "#d98324",
        "shape": "rect",
        "icon": "⎈",
        "properties": [
            {
                "key": "image",
                "label": "Image",
                "type": "string"
            },
            {
                "key": "cpu",
                "label": "vCPU",
                "type": "number"
            },
            {
                "key": "memoryMb",
                "label": "Memory (MB)",
                "type": "number"
            },
            {
                "key": "port",
                "label": "Exposed port",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudContainerTask",
        "name": "Container Task (Fargate/ECS)",
        "category": "Cloud · Compute",
        "color": "#e8902a",
        "shape": "rounded",
        "icon": "🧩",
        "properties": [
            {
                "key": "launchType",
                "label": "Launch type",
                "type": "string"
            },
            {
                "key": "cpu",
                "label": "Task vCPU",
                "type": "number"
            },
            {
                "key": "memoryMb",
                "label": "Task memory (MB)",
                "type": "number"
            },
            {
                "key": "desiredCount",
                "label": "Desired count",
                "type": "number"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudContainerImage",
        "name": "Container Image / Registry (ECR)",
        "category": "Cloud · Compute",
        "color": "#b5651d",
        "shape": "cylinder",
        "icon": "📦",
        "properties": [
            {
                "key": "repository",
                "label": "Repository",
                "type": "string"
            },
            {
                "key": "tag",
                "label": "Tag",
                "type": "string"
            },
            {
                "key": "digest",
                "label": "Digest",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudPaasService",
        "name": "App / PaaS Service (App Runner/Beanstalk)",
        "category": "Cloud · Compute",
        "color": "#f08c00",
        "shape": "rounded",
        "icon": "🚀",
        "properties": [
            {
                "key": "platform",
                "label": "Platform",
                "type": "string"
            },
            {
                "key": "source",
                "label": "Source (repo/image)",
                "type": "string"
            },
            {
                "key": "instances",
                "label": "Instance count",
                "type": "number"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudBatchJob",
        "name": "Batch Job",
        "category": "Cloud · Compute",
        "color": "#cc7a00",
        "shape": "rect",
        "icon": "🧮",
        "properties": [
            {
                "key": "jobQueue",
                "label": "Job queue",
                "type": "string"
            },
            {
                "key": "vcpus",
                "label": "vCPUs",
                "type": "number"
            },
            {
                "key": "memoryMb",
                "label": "Memory (MB)",
                "type": "number"
            },
            {
                "key": "arraySize",
                "label": "Array size",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudStateMachine",
        "name": "Workflow / State Machine (Step Functions)",
        "category": "Cloud · Compute",
        "color": "#e3651d",
        "shape": "diamond",
        "icon": "🔀",
        "properties": [
            {
                "key": "type",
                "label": "Type (standard/express)",
                "type": "string"
            },
            {
                "key": "states",
                "label": "State count",
                "type": "number"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudEventBus",
        "name": "Event Bus (EventBridge)",
        "category": "Cloud · Compute",
        "color": "#d4761a",
        "shape": "diamond",
        "icon": "🛰️",
        "properties": [
            {
                "key": "busName",
                "label": "Bus name",
                "type": "string"
            },
            {
                "key": "ruleCount",
                "label": "Rule count",
                "type": "number"
            },
            {
                "key": "source",
                "label": "Event source",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudScheduledTask",
        "name": "Cron / Scheduled Task",
        "category": "Cloud · Compute",
        "color": "#bf7d2c",
        "shape": "rounded",
        "icon": "⏰",
        "properties": [
            {
                "key": "schedule",
                "label": "Schedule (cron/rate)",
                "type": "string"
            },
            {
                "key": "target",
                "label": "Target",
                "type": "string"
            },
            {
                "key": "timezone",
                "label": "Timezone",
                "type": "string"
            },
            {
                "key": "enabled",
                "label": "Enabled (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudClient",
        "name": "Client / Browser",
        "category": "Cloud · Compute",
        "color": "#7e9cc9",
        "shape": "rect",
        "icon": "🖱️",
        "properties": [
            {
                "key": "platform",
                "label": "Platform (web/mobile/desktop)",
                "type": "string"
            },
            {
                "key": "userAgent",
                "label": "User agent",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudMobileApp",
        "name": "Mobile App",
        "category": "Cloud · Compute",
        "color": "#6b8fc4",
        "shape": "rounded",
        "icon": "📱",
        "properties": [
            {
                "key": "os",
                "label": "OS (iOS/Android)",
                "type": "string"
            },
            {
                "key": "version",
                "label": "App version",
                "type": "string"
            },
            {
                "key": "distribution",
                "label": "Distribution channel",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudBastionHost",
        "name": "Bastion / Jump Host",
        "category": "Cloud · Compute",
        "color": "#b5651d",
        "shape": "rect",
        "icon": "🛡️",
        "properties": [
            {
                "key": "publicIp",
                "label": "Public IP",
                "type": "string"
            },
            {
                "key": "subnet",
                "label": "Subnet",
                "type": "string"
            },
            {
                "key": "sshPort",
                "label": "SSH port",
                "type": "number"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudSpotFleet",
        "name": "Spot / Preemptible Fleet",
        "category": "Cloud · Compute",
        "color": "#d68a2a",
        "shape": "rounded",
        "icon": "💸",
        "properties": [
            {
                "key": "targetCapacity",
                "label": "Target capacity",
                "type": "number"
            },
            {
                "key": "instanceTypes",
                "label": "Instance types",
                "type": "string"
            },
            {
                "key": "allocationStrategy",
                "label": "Allocation strategy",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudGpuInstance",
        "name": "GPU / ML Compute",
        "category": "Cloud · Compute",
        "color": "#c96a17",
        "shape": "rect",
        "icon": "🎮",
        "properties": [
            {
                "key": "gpuType",
                "label": "GPU type",
                "type": "string"
            },
            {
                "key": "gpuCount",
                "label": "GPU count",
                "type": "number"
            },
            {
                "key": "instanceType",
                "label": "Instance type",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudWorkerService",
        "name": "Background Worker / Daemon",
        "category": "Cloud · Compute",
        "color": "#e8902a",
        "shape": "rect",
        "icon": "🛠️",
        "properties": [
            {
                "key": "queueSource",
                "label": "Queue source",
                "type": "string"
            },
            {
                "key": "concurrency",
                "label": "Concurrency",
                "type": "number"
            },
            {
                "key": "runtime",
                "label": "Runtime",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudMicroservice",
        "name": "Microservice",
        "category": "Cloud · Compute",
        "color": "#f5a623",
        "shape": "rounded",
        "icon": "🧰",
        "properties": [
            {
                "key": "language",
                "label": "Language / Framework",
                "type": "string"
            },
            {
                "key": "team",
                "label": "Owning team",
                "type": "string"
            },
            {
                "key": "apiStyle",
                "label": "API style (REST/gRPC)",
                "type": "string"
            },
            {
                "key": "version",
                "label": "Version",
                "type": "string"
            }
        ]
    },
    {
        "id": "awsS3",
        "name": "S3 Bucket",
        "category": "Cloud · Storage & Data",
        "color": "#3b9b6e",
        "shape": "cylinder",
        "icon": "🪣",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "encryption",
                "label": "Encryption",
                "type": "string"
            },
            {
                "key": "public",
                "label": "Public (yes/no)",
                "type": "string"
            },
            {
                "key": "versioning",
                "label": "Versioning",
                "type": "string"
            },
            {
                "key": "objectCount",
                "label": "Object count",
                "type": "number"
            }
        ]
    },
    {
        "id": "awsEbs",
        "name": "Block Volume (EBS)",
        "category": "Cloud · Storage & Data",
        "color": "#2f8fa8",
        "shape": "cylinder",
        "icon": "💽",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "az",
                "label": "Availability zone",
                "type": "string"
            },
            {
                "key": "volumeType",
                "label": "Volume type",
                "type": "string"
            },
            {
                "key": "sizeGb",
                "label": "Size (GB)",
                "type": "number"
            },
            {
                "key": "encrypted",
                "label": "Encrypted (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "awsFileShare",
        "name": "File Share (EFS/FSx)",
        "category": "Cloud · Storage & Data",
        "color": "#4aa3c4",
        "shape": "cylinder",
        "icon": "📁",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "protocol",
                "label": "Protocol (NFS/SMB)",
                "type": "string"
            },
            {
                "key": "performanceMode",
                "label": "Performance mode",
                "type": "string"
            },
            {
                "key": "throughputMode",
                "label": "Throughput mode",
                "type": "string"
            }
        ]
    },
    {
        "id": "awsRds",
        "name": "Relational DB (RDS)",
        "category": "Cloud · Storage & Data",
        "color": "#3f6fb5",
        "shape": "cylinder",
        "icon": "🗄️",
        "properties": [
            {
                "key": "engine",
                "label": "Engine",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "instanceClass",
                "label": "Instance class",
                "type": "string"
            },
            {
                "key": "multiAz",
                "label": "Multi-AZ (yes/no)",
                "type": "string"
            },
            {
                "key": "storageGb",
                "label": "Storage (GB)",
                "type": "number"
            }
        ]
    },
    {
        "id": "awsDynamodb",
        "name": "NoSQL Table (DynamoDB)",
        "category": "Cloud · Storage & Data",
        "color": "#4f63b8",
        "shape": "cylinder",
        "icon": "⚡",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "partitionKey",
                "label": "Partition key",
                "type": "string"
            },
            {
                "key": "billingMode",
                "label": "Billing mode",
                "type": "string"
            },
            {
                "key": "globalTable",
                "label": "Global table (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "awsElasticache",
        "name": "Cache (ElastiCache/Redis)",
        "category": "Cloud · Storage & Data",
        "color": "#c0504d",
        "shape": "cylinder",
        "icon": "⚙️",
        "properties": [
            {
                "key": "engine",
                "label": "Engine (Redis/Memcached)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "nodeType",
                "label": "Node type",
                "type": "string"
            },
            {
                "key": "nodeCount",
                "label": "Node count",
                "type": "number"
            }
        ]
    },
    {
        "id": "awsRedshift",
        "name": "Data Warehouse (Redshift/BigQuery)",
        "category": "Cloud · Storage & Data",
        "color": "#2e6f9e",
        "shape": "cylinder",
        "icon": "🏬",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "nodeType",
                "label": "Node type",
                "type": "string"
            },
            {
                "key": "nodeCount",
                "label": "Node count",
                "type": "number"
            },
            {
                "key": "encryption",
                "label": "Encryption",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudDataLake",
        "name": "Data Lake",
        "category": "Cloud · Storage & Data",
        "color": "#1f6f78",
        "shape": "cylinder",
        "icon": "🌊",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "format",
                "label": "Storage format",
                "type": "string"
            },
            {
                "key": "catalog",
                "label": "Catalog",
                "type": "string"
            },
            {
                "key": "sizeTb",
                "label": "Size (TB)",
                "type": "number"
            }
        ]
    },
    {
        "id": "awsSqs",
        "name": "Queue (SQS)",
        "category": "Cloud · Storage & Data",
        "color": "#d98c2b",
        "shape": "rounded",
        "icon": "📨",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "queueType",
                "label": "Type (Standard/FIFO)",
                "type": "string"
            },
            {
                "key": "visibilityTimeout",
                "label": "Visibility timeout (s)",
                "type": "number"
            },
            {
                "key": "dlq",
                "label": "Dead-letter queue (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "awsSns",
        "name": "Topic / Pub-Sub (SNS/Kafka)",
        "category": "Cloud · Storage & Data",
        "color": "#e0a13a",
        "shape": "rounded",
        "icon": "📢",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "topicType",
                "label": "Type (Standard/FIFO)",
                "type": "string"
            },
            {
                "key": "protocol",
                "label": "Subscription protocol",
                "type": "string"
            },
            {
                "key": "subscribers",
                "label": "Subscribers",
                "type": "number"
            }
        ]
    },
    {
        "id": "awsKinesis",
        "name": "Stream (Kinesis)",
        "category": "Cloud · Storage & Data",
        "color": "#c77d1f",
        "shape": "rounded",
        "icon": "🌀",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "shardCount",
                "label": "Shard count",
                "type": "number"
            },
            {
                "key": "retentionHours",
                "label": "Retention (hours)",
                "type": "number"
            },
            {
                "key": "encryption",
                "label": "Encryption",
                "type": "string"
            }
        ]
    },
    {
        "id": "awsOpensearch",
        "name": "Search (OpenSearch)",
        "category": "Cloud · Storage & Data",
        "color": "#7a5fc0",
        "shape": "cylinder",
        "icon": "🔍",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "version",
                "label": "Engine version",
                "type": "string"
            },
            {
                "key": "nodeCount",
                "label": "Node count",
                "type": "number"
            },
            {
                "key": "storageGb",
                "label": "Storage (GB)",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudBackup",
        "name": "Backup / Snapshot",
        "category": "Cloud · Storage & Data",
        "color": "#5c8a72",
        "shape": "cylinder",
        "icon": "💾",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "sourceResource",
                "label": "Source resource",
                "type": "string"
            },
            {
                "key": "retentionDays",
                "label": "Retention (days)",
                "type": "number"
            },
            {
                "key": "encrypted",
                "label": "Encrypted (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudTimeSeriesDb",
        "name": "Time-Series DB",
        "category": "Cloud · Storage & Data",
        "color": "#3f7f8f",
        "shape": "cylinder",
        "icon": "📈",
        "properties": [
            {
                "key": "engine",
                "label": "Engine (Timestream/Influx)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "retention",
                "label": "Retention",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudGraphDb",
        "name": "Graph DB",
        "category": "Cloud · Storage & Data",
        "color": "#4a6fb0",
        "shape": "cylinder",
        "icon": "🕸️",
        "properties": [
            {
                "key": "engine",
                "label": "Engine (Neptune/Neo4j)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "model",
                "label": "Model (property/RDF)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudDocumentDb",
        "name": "Document DB",
        "category": "Cloud · Storage & Data",
        "color": "#4356a8",
        "shape": "cylinder",
        "icon": "📑",
        "properties": [
            {
                "key": "engine",
                "label": "Engine (DocumentDB/Mongo)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "instanceClass",
                "label": "Instance class",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudLedgerDb",
        "name": "Ledger DB",
        "category": "Cloud · Storage & Data",
        "color": "#2f4f8f",
        "shape": "cylinder",
        "icon": "📒",
        "properties": [
            {
                "key": "engine",
                "label": "Engine (QLDB)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "immutable",
                "label": "Immutable (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudVectorDb",
        "name": "Vector DB",
        "category": "Cloud · Storage & Data",
        "color": "#5f5fc0",
        "shape": "cylinder",
        "icon": "🧬",
        "properties": [
            {
                "key": "engine",
                "label": "Engine (Pinecone/pgvector)",
                "type": "string"
            },
            {
                "key": "dimensions",
                "label": "Dimensions",
                "type": "number"
            },
            {
                "key": "metric",
                "label": "Distance metric",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudMessageBroker",
        "name": "Message Broker (RabbitMQ/MQ)",
        "category": "Cloud · Storage & Data",
        "color": "#d4761a",
        "shape": "rounded",
        "icon": "📬",
        "properties": [
            {
                "key": "engine",
                "label": "Engine (RabbitMQ/ActiveMQ)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "protocol",
                "label": "Protocol (AMQP/MQTT)",
                "type": "string"
            },
            {
                "key": "clusterMode",
                "label": "Cluster mode",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudKafkaCluster",
        "name": "Kafka Cluster (MSK)",
        "category": "Cloud · Storage & Data",
        "color": "#bf6a14",
        "shape": "rounded",
        "icon": "🌊",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "brokerCount",
                "label": "Broker count",
                "type": "number"
            },
            {
                "key": "version",
                "label": "Kafka version",
                "type": "string"
            },
            {
                "key": "topicCount",
                "label": "Topic count",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudKafkaTopic",
        "name": "Kafka / Stream Topic",
        "category": "Cloud · Storage & Data",
        "color": "#d98c2b",
        "shape": "rounded",
        "icon": "🗞️",
        "properties": [
            {
                "key": "name",
                "label": "Topic name",
                "type": "string"
            },
            {
                "key": "partitions",
                "label": "Partitions",
                "type": "number"
            },
            {
                "key": "replicationFactor",
                "label": "Replication factor",
                "type": "number"
            },
            {
                "key": "retentionMs",
                "label": "Retention (ms)",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudEtlJob",
        "name": "ETL / Data Pipeline Job",
        "category": "Cloud · Storage & Data",
        "color": "#2f8f7a",
        "shape": "rect",
        "icon": "🔧",
        "properties": [
            {
                "key": "engine",
                "label": "Engine (Glue/Spark)",
                "type": "string"
            },
            {
                "key": "schedule",
                "label": "Schedule",
                "type": "string"
            },
            {
                "key": "source",
                "label": "Source",
                "type": "string"
            },
            {
                "key": "sink",
                "label": "Sink",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudQueryEngine",
        "name": "Query Engine (Athena/Presto)",
        "category": "Cloud · Storage & Data",
        "color": "#3b9b6e",
        "shape": "diamond",
        "icon": "🔎",
        "properties": [
            {
                "key": "engine",
                "label": "Engine",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "dataSource",
                "label": "Data source",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudDataCatalog",
        "name": "Data Catalog / Metastore",
        "category": "Cloud · Storage & Data",
        "color": "#2e6f5e",
        "shape": "cylinder",
        "icon": "🗂️",
        "properties": [
            {
                "key": "engine",
                "label": "Engine (Glue/Hive)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "tableCount",
                "label": "Table count",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudFeatureStore",
        "name": "Feature Store",
        "category": "Cloud · Storage & Data",
        "color": "#4f63b8",
        "shape": "cylinder",
        "icon": "🧮",
        "properties": [
            {
                "key": "online",
                "label": "Online store (yes/no)",
                "type": "string"
            },
            {
                "key": "offline",
                "label": "Offline store (yes/no)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudVpc",
        "name": "VPC",
        "category": "Cloud · Network",
        "color": "#3d7e3d",
        "shape": "rounded",
        "icon": "🕸️",
        "properties": [
            {
                "key": "cidr",
                "label": "CIDR block",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "tenancy",
                "label": "Tenancy",
                "type": "string"
            },
            {
                "key": "dnsSupport",
                "label": "DNS support (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudSubnetPublic",
        "name": "Public Subnet",
        "category": "Cloud · Network",
        "color": "#52a052",
        "shape": "rounded",
        "icon": "🌿",
        "properties": [
            {
                "key": "cidr",
                "label": "CIDR block",
                "type": "string"
            },
            {
                "key": "az",
                "label": "Availability Zone",
                "type": "string"
            },
            {
                "key": "autoPublicIp",
                "label": "Auto-assign public IP (yes/no)",
                "type": "string"
            },
            {
                "key": "availableIps",
                "label": "Available IPs",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudSubnetPrivate",
        "name": "Private Subnet",
        "category": "Cloud · Network",
        "color": "#3f7f3f",
        "shape": "rounded",
        "icon": "🌱",
        "properties": [
            {
                "key": "cidr",
                "label": "CIDR block",
                "type": "string"
            },
            {
                "key": "az",
                "label": "Availability Zone",
                "type": "string"
            },
            {
                "key": "routeTable",
                "label": "Route table",
                "type": "string"
            },
            {
                "key": "availableIps",
                "label": "Available IPs",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudInternetGateway",
        "name": "Internet Gateway",
        "category": "Cloud · Network",
        "color": "#2e8b57",
        "shape": "diamond",
        "icon": "🚪",
        "properties": [
            {
                "key": "vpc",
                "label": "Attached VPC",
                "type": "string"
            },
            {
                "key": "state",
                "label": "State",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudNatGateway",
        "name": "NAT Gateway",
        "category": "Cloud · Network",
        "color": "#5fae7a",
        "shape": "diamond",
        "icon": "🔁",
        "properties": [
            {
                "key": "subnet",
                "label": "Subnet",
                "type": "string"
            },
            {
                "key": "elasticIp",
                "label": "Elastic IP",
                "type": "string"
            },
            {
                "key": "connectivity",
                "label": "Connectivity (public/private)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudVpnGateway",
        "name": "VPN Gateway",
        "category": "Cloud · Network",
        "color": "#4c9a8a",
        "shape": "diamond",
        "icon": "🔐",
        "properties": [
            {
                "key": "type",
                "label": "Type",
                "type": "string"
            },
            {
                "key": "asn",
                "label": "Amazon-side ASN",
                "type": "number"
            },
            {
                "key": "vpc",
                "label": "Attached VPC",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudVpnConnection",
        "name": "VPN Connection",
        "category": "Cloud · Network",
        "color": "#3f8c95",
        "shape": "rect",
        "icon": "🔗",
        "properties": [
            {
                "key": "customerGateway",
                "label": "Customer gateway IP",
                "type": "string"
            },
            {
                "key": "tunnelCount",
                "label": "Tunnels",
                "type": "number"
            },
            {
                "key": "routing",
                "label": "Routing (static/BGP)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudTransitGateway",
        "name": "Transit Gateway",
        "category": "Cloud · Network",
        "color": "#2f6f5e",
        "shape": "diamond",
        "icon": "🔀",
        "properties": [
            {
                "key": "asn",
                "label": "Amazon-side ASN",
                "type": "number"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "defaultRouteTable",
                "label": "Default route table assoc (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudDirectConnect",
        "name": "Direct Connect",
        "category": "Cloud · Network",
        "color": "#6aa84f",
        "shape": "rect",
        "icon": "🧷",
        "properties": [
            {
                "key": "location",
                "label": "Colo location",
                "type": "string"
            },
            {
                "key": "bandwidth",
                "label": "Bandwidth (Gbps)",
                "type": "number"
            },
            {
                "key": "vlan",
                "label": "VLAN",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudVpcPeering",
        "name": "VPC Peering",
        "category": "Cloud · Network",
        "color": "#7fb069",
        "shape": "diamond",
        "icon": "🤝",
        "properties": [
            {
                "key": "requesterVpc",
                "label": "Requester VPC",
                "type": "string"
            },
            {
                "key": "accepterVpc",
                "label": "Accepter VPC",
                "type": "string"
            },
            {
                "key": "status",
                "label": "Status",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudRouteTable",
        "name": "Route Table",
        "category": "Cloud · Network",
        "color": "#8aae6c",
        "shape": "rect",
        "icon": "🧭",
        "properties": [
            {
                "key": "vpc",
                "label": "VPC",
                "type": "string"
            },
            {
                "key": "routeCount",
                "label": "Routes",
                "type": "number"
            },
            {
                "key": "main",
                "label": "Main table (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudSecurityGroup",
        "name": "Security Group",
        "category": "Cloud · Network",
        "color": "#c0504d",
        "shape": "rect",
        "icon": "🧯",
        "properties": [
            {
                "key": "vpc",
                "label": "VPC",
                "type": "string"
            },
            {
                "key": "inboundRules",
                "label": "Inbound rules",
                "type": "number"
            },
            {
                "key": "outboundRules",
                "label": "Outbound rules",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudNetworkAcl",
        "name": "Network ACL",
        "category": "Cloud · Network",
        "color": "#d27a76",
        "shape": "rect",
        "icon": "📋",
        "properties": [
            {
                "key": "vpc",
                "label": "VPC",
                "type": "string"
            },
            {
                "key": "ruleCount",
                "label": "Rules",
                "type": "number"
            },
            {
                "key": "default",
                "label": "Default ACL (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudLoadBalancerAlb",
        "name": "Application Load Balancer",
        "category": "Cloud · Network",
        "color": "#e08e3c",
        "shape": "diamond",
        "icon": "⚖️",
        "properties": [
            {
                "key": "scheme",
                "label": "Scheme (internet/internal)",
                "type": "string"
            },
            {
                "key": "listeners",
                "label": "Listeners",
                "type": "number"
            },
            {
                "key": "az",
                "label": "Availability Zones",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudLoadBalancerNlb",
        "name": "Network Load Balancer",
        "category": "Cloud · Network",
        "color": "#c97b2f",
        "shape": "diamond",
        "icon": "🪜",
        "properties": [
            {
                "key": "scheme",
                "label": "Scheme (internet/internal)",
                "type": "string"
            },
            {
                "key": "protocol",
                "label": "Protocol (TCP/UDP/TLS)",
                "type": "string"
            },
            {
                "key": "staticIp",
                "label": "Static IP (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudTargetGroup",
        "name": "Target Group",
        "category": "Cloud · Network",
        "color": "#f0a868",
        "shape": "rect",
        "icon": "🎯",
        "properties": [
            {
                "key": "targetType",
                "label": "Target type (instance/ip/lambda)",
                "type": "string"
            },
            {
                "key": "protocol",
                "label": "Protocol",
                "type": "string"
            },
            {
                "key": "port",
                "label": "Port",
                "type": "number"
            },
            {
                "key": "healthCheck",
                "label": "Health check path",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudCdn",
        "name": "CDN (CloudFront)",
        "category": "Cloud · Network",
        "color": "#9b59b6",
        "shape": "rounded",
        "icon": "🌍",
        "properties": [
            {
                "key": "origin",
                "label": "Origin",
                "type": "string"
            },
            {
                "key": "priceClass",
                "label": "Price class",
                "type": "string"
            },
            {
                "key": "tls",
                "label": "TLS / cert",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudDnsZone",
        "name": "DNS Zone (Route53)",
        "category": "Cloud · Network",
        "color": "#4e79a7",
        "shape": "cylinder",
        "icon": "📒",
        "properties": [
            {
                "key": "domain",
                "label": "Domain name",
                "type": "string"
            },
            {
                "key": "visibility",
                "label": "Visibility (public/private)",
                "type": "string"
            },
            {
                "key": "recordCount",
                "label": "Records",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudDnsRecord",
        "name": "DNS Record",
        "category": "Cloud · Network",
        "color": "#6b94c4",
        "shape": "rect",
        "icon": "🏷️",
        "properties": [
            {
                "key": "recordType",
                "label": "Type (A/CNAME/MX/TXT)",
                "type": "string"
            },
            {
                "key": "value",
                "label": "Value",
                "type": "string"
            },
            {
                "key": "ttl",
                "label": "TTL",
                "type": "number"
            },
            {
                "key": "routingPolicy",
                "label": "Routing policy",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudApiGateway",
        "name": "API Gateway",
        "category": "Cloud · Network",
        "color": "#d35e8c",
        "shape": "diamond",
        "icon": "🚦",
        "properties": [
            {
                "key": "apiType",
                "label": "Type (REST/HTTP/WebSocket)",
                "type": "string"
            },
            {
                "key": "stage",
                "label": "Stage",
                "type": "string"
            },
            {
                "key": "endpoint",
                "label": "Endpoint type",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudWaf",
        "name": "WAF",
        "category": "Cloud · Network",
        "color": "#a83f3f",
        "shape": "rect",
        "icon": "🧱",
        "properties": [
            {
                "key": "scope",
                "label": "Scope (regional/cloudfront)",
                "type": "string"
            },
            {
                "key": "ruleCount",
                "label": "Rules",
                "type": "number"
            },
            {
                "key": "defaultAction",
                "label": "Default action (allow/block)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudFirewall",
        "name": "Firewall",
        "category": "Cloud · Network",
        "color": "#b34747",
        "shape": "rect",
        "icon": "🔥",
        "properties": [
            {
                "key": "vpc",
                "label": "VPC",
                "type": "string"
            },
            {
                "key": "policy",
                "label": "Firewall policy",
                "type": "string"
            },
            {
                "key": "statefulRules",
                "label": "Stateful rules",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudVpcEndpoint",
        "name": "VPC Endpoint (PrivateLink)",
        "category": "Cloud · Network",
        "color": "#3d7e3d",
        "shape": "diamond",
        "icon": "🔌",
        "properties": [
            {
                "key": "serviceName",
                "label": "Service name",
                "type": "string"
            },
            {
                "key": "type",
                "label": "Type (Gateway/Interface)",
                "type": "string"
            },
            {
                "key": "vpc",
                "label": "VPC",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudElasticIp",
        "name": "Elastic / Static IP",
        "category": "Cloud · Network",
        "color": "#5fae7a",
        "shape": "rect",
        "icon": "📍",
        "properties": [
            {
                "key": "address",
                "label": "IP address",
                "type": "string"
            },
            {
                "key": "associatedWith",
                "label": "Associated resource",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudGatewayLoadBalancer",
        "name": "Gateway Load Balancer",
        "category": "Cloud · Network",
        "color": "#d68a3c",
        "shape": "diamond",
        "icon": "🛂",
        "properties": [
            {
                "key": "appliance",
                "label": "Appliance type",
                "type": "string"
            },
            {
                "key": "vpc",
                "label": "VPC",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudGlobalAccelerator",
        "name": "Global Accelerator",
        "category": "Cloud · Network",
        "color": "#4ca890",
        "shape": "diamond",
        "icon": "🚀",
        "properties": [
            {
                "key": "staticIps",
                "label": "Static IPs",
                "type": "string"
            },
            {
                "key": "endpointGroups",
                "label": "Endpoint groups",
                "type": "number"
            },
            {
                "key": "protocol",
                "label": "Protocol",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudServiceMesh",
        "name": "Service Mesh",
        "category": "Cloud · Network",
        "color": "#5b8fb0",
        "shape": "rounded",
        "icon": "🕸️",
        "properties": [
            {
                "key": "implementation",
                "label": "Implementation (Istio/AppMesh)",
                "type": "string"
            },
            {
                "key": "mtls",
                "label": "mTLS (yes/no)",
                "type": "string"
            },
            {
                "key": "serviceCount",
                "label": "Service count",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudPrivateLinkService",
        "name": "PrivateLink Service",
        "category": "Cloud · Network",
        "color": "#3f8c95",
        "shape": "diamond",
        "icon": "🔗",
        "properties": [
            {
                "key": "serviceName",
                "label": "Service name",
                "type": "string"
            },
            {
                "key": "acceptanceRequired",
                "label": "Acceptance required (yes/no)",
                "type": "string"
            },
            {
                "key": "nlb",
                "label": "Backing NLB",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudDnsHealthCheck",
        "name": "DNS Health Check",
        "category": "Cloud · Network",
        "color": "#76b7b2",
        "shape": "diamond",
        "icon": "❤️",
        "properties": [
            {
                "key": "endpoint",
                "label": "Endpoint",
                "type": "string"
            },
            {
                "key": "protocol",
                "label": "Protocol",
                "type": "string"
            },
            {
                "key": "interval",
                "label": "Interval (s)",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudApiStage",
        "name": "API Stage / Deployment",
        "category": "Cloud · Network",
        "color": "#c7568a",
        "shape": "rect",
        "icon": "📶",
        "properties": [
            {
                "key": "stageName",
                "label": "Stage name",
                "type": "string"
            },
            {
                "key": "throttle",
                "label": "Throttle (req/s)",
                "type": "number"
            },
            {
                "key": "cacheEnabled",
                "label": "Cache enabled (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudAvailabilityZone",
        "name": "Availability Zone",
        "category": "Cloud · Network",
        "color": "#76b7b2",
        "shape": "rounded",
        "icon": "🏟️",
        "properties": [
            {
                "key": "zoneId",
                "label": "Zone ID",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "zoneType",
                "label": "Zone type",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudRegion",
        "name": "Region",
        "category": "Cloud · Network",
        "color": "#5b8fb0",
        "shape": "rounded",
        "icon": "🗺️",
        "properties": [
            {
                "key": "code",
                "label": "Region code",
                "type": "string"
            },
            {
                "key": "geography",
                "label": "Geography",
                "type": "string"
            },
            {
                "key": "azCount",
                "label": "Availability Zones",
                "type": "number"
            }
        ]
    },
    {
        "id": "netOnPremDatacenter",
        "name": "On-Prem Data Center",
        "category": "Cloud · Network",
        "color": "#7f6b5a",
        "shape": "cylinder",
        "icon": "🏭",
        "properties": [
            {
                "key": "location",
                "label": "Location",
                "type": "string"
            },
            {
                "key": "cidr",
                "label": "Network CIDR",
                "type": "string"
            },
            {
                "key": "connectivity",
                "label": "Connectivity (VPN/DX)",
                "type": "string"
            }
        ]
    },
    {
        "id": "netRouter",
        "name": "Router",
        "category": "Cloud · Network",
        "color": "#9c755f",
        "shape": "rect",
        "icon": "📶",
        "properties": [
            {
                "key": "model",
                "label": "Model",
                "type": "string"
            },
            {
                "key": "mgmtIp",
                "label": "Management IP",
                "type": "string"
            },
            {
                "key": "protocol",
                "label": "Routing protocol",
                "type": "string"
            }
        ]
    },
    {
        "id": "netSwitch",
        "name": "Switch",
        "category": "Cloud · Network",
        "color": "#b08968",
        "shape": "rect",
        "icon": "🔳",
        "properties": [
            {
                "key": "model",
                "label": "Model",
                "type": "string"
            },
            {
                "key": "portCount",
                "label": "Ports",
                "type": "number"
            },
            {
                "key": "layer",
                "label": "Layer (L2/L3)",
                "type": "string"
            },
            {
                "key": "vlans",
                "label": "VLANs",
                "type": "string"
            }
        ]
    },
    {
        "id": "netLoadBalancerOnPrem",
        "name": "Load Balancer (On-Prem)",
        "category": "Cloud · Network",
        "color": "#a8814f",
        "shape": "diamond",
        "icon": "⚖️",
        "properties": [
            {
                "key": "vendor",
                "label": "Vendor (F5/HAProxy/Nginx)",
                "type": "string"
            },
            {
                "key": "mgmtIp",
                "label": "Management IP",
                "type": "string"
            },
            {
                "key": "mode",
                "label": "Mode (L4/L7)",
                "type": "string"
            }
        ]
    },
    {
        "id": "netFirewallAppliance",
        "name": "Firewall Appliance (On-Prem)",
        "category": "Cloud · Network",
        "color": "#b34747",
        "shape": "rect",
        "icon": "🔥",
        "properties": [
            {
                "key": "vendor",
                "label": "Vendor",
                "type": "string"
            },
            {
                "key": "mgmtIp",
                "label": "Management IP",
                "type": "string"
            },
            {
                "key": "ruleCount",
                "label": "Rule count",
                "type": "number"
            }
        ]
    },
    {
        "id": "netWirelessAp",
        "name": "Wireless Access Point",
        "category": "Cloud · Network",
        "color": "#b08968",
        "shape": "rect",
        "icon": "📡",
        "properties": [
            {
                "key": "ssid",
                "label": "SSID",
                "type": "string"
            },
            {
                "key": "band",
                "label": "Band (2.4/5/6GHz)",
                "type": "string"
            },
            {
                "key": "mgmtIp",
                "label": "Management IP",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sCluster",
        "name": "Kubernetes Cluster",
        "category": "Kubernetes",
        "color": "#326ce5",
        "shape": "rounded",
        "icon": "⎈",
        "properties": [
            {
                "key": "version",
                "label": "K8s version",
                "type": "string"
            },
            {
                "key": "provider",
                "label": "Provider (EKS/GKE/AKS)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "nodeCount",
                "label": "Node count",
                "type": "number"
            }
        ]
    },
    {
        "id": "k8sNode",
        "name": "Node / Worker",
        "category": "Kubernetes",
        "color": "#4a86e8",
        "shape": "cylinder",
        "icon": "🖧",
        "properties": [
            {
                "key": "instanceType",
                "label": "Instance type",
                "type": "string"
            },
            {
                "key": "os",
                "label": "OS image",
                "type": "string"
            },
            {
                "key": "cpu",
                "label": "vCPU",
                "type": "number"
            },
            {
                "key": "memoryGi",
                "label": "Memory (Gi)",
                "type": "number"
            }
        ]
    },
    {
        "id": "k8sNamespace",
        "name": "Namespace",
        "category": "Kubernetes",
        "color": "#6fa8dc",
        "shape": "swimlane",
        "icon": "▦",
        "properties": [
            {
                "key": "name",
                "label": "Name",
                "type": "string"
            },
            {
                "key": "labels",
                "label": "Labels",
                "type": "string"
            },
            {
                "key": "quotaCpu",
                "label": "CPU quota",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sPod",
        "name": "Pod",
        "category": "Kubernetes",
        "color": "#2f5fc9",
        "shape": "rounded",
        "icon": "⬢",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "phase",
                "label": "Phase",
                "type": "string"
            },
            {
                "key": "nodeName",
                "label": "Node",
                "type": "string"
            },
            {
                "key": "podIP",
                "label": "Pod IP",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sDeployment",
        "name": "Deployment",
        "category": "Kubernetes",
        "color": "#1c4fb0",
        "shape": "rect",
        "icon": "🚀",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "replicas",
                "label": "Replicas",
                "type": "number"
            },
            {
                "key": "strategy",
                "label": "Update strategy",
                "type": "string"
            },
            {
                "key": "image",
                "label": "Image",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sReplicaSet",
        "name": "ReplicaSet",
        "category": "Kubernetes",
        "color": "#3d6fd0",
        "shape": "rect",
        "icon": "❑",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "desired",
                "label": "Desired replicas",
                "type": "number"
            },
            {
                "key": "ready",
                "label": "Ready replicas",
                "type": "number"
            }
        ]
    },
    {
        "id": "k8sStatefulSet",
        "name": "StatefulSet",
        "category": "Kubernetes",
        "color": "#1a3f8f",
        "shape": "rect",
        "icon": "🗃️",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "replicas",
                "label": "Replicas",
                "type": "number"
            },
            {
                "key": "serviceName",
                "label": "Headless service",
                "type": "string"
            },
            {
                "key": "storageClass",
                "label": "Storage class",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sDaemonSet",
        "name": "DaemonSet",
        "category": "Kubernetes",
        "color": "#5b7fd4",
        "shape": "rect",
        "icon": "👹",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "image",
                "label": "Image",
                "type": "string"
            },
            {
                "key": "nodeSelector",
                "label": "Node selector",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sJob",
        "name": "Job",
        "category": "Kubernetes",
        "color": "#7e57c2",
        "shape": "rect",
        "icon": "⚙️",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "completions",
                "label": "Completions",
                "type": "number"
            },
            {
                "key": "parallelism",
                "label": "Parallelism",
                "type": "number"
            },
            {
                "key": "backoffLimit",
                "label": "Backoff limit",
                "type": "number"
            }
        ]
    },
    {
        "id": "k8sCronJob",
        "name": "CronJob",
        "category": "Kubernetes",
        "color": "#9575cd",
        "shape": "rect",
        "icon": "⏰",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "schedule",
                "label": "Schedule (cron)",
                "type": "string"
            },
            {
                "key": "concurrencyPolicy",
                "label": "Concurrency policy",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sService",
        "name": "Service",
        "category": "Kubernetes",
        "color": "#43a047",
        "shape": "diamond",
        "icon": "🔀",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "type",
                "label": "Type (ClusterIP/NodePort/LB)",
                "type": "string"
            },
            {
                "key": "clusterIP",
                "label": "Cluster IP",
                "type": "string"
            },
            {
                "key": "port",
                "label": "Port",
                "type": "number"
            }
        ]
    },
    {
        "id": "k8sIngress",
        "name": "Ingress",
        "category": "Kubernetes",
        "color": "#2e7d32",
        "shape": "diamond",
        "icon": "🚪",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "host",
                "label": "Host",
                "type": "string"
            },
            {
                "key": "ingressClass",
                "label": "Ingress class",
                "type": "string"
            },
            {
                "key": "tls",
                "label": "TLS (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sConfigMap",
        "name": "ConfigMap",
        "category": "Kubernetes",
        "color": "#00897b",
        "shape": "cylinder",
        "icon": "🧩",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "keys",
                "label": "Key count",
                "type": "number"
            },
            {
                "key": "immutable",
                "label": "Immutable (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sSecret",
        "name": "Secret",
        "category": "Kubernetes",
        "color": "#c62828",
        "shape": "cylinder",
        "icon": "🔐",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "type",
                "label": "Type",
                "type": "string"
            },
            {
                "key": "keys",
                "label": "Key count",
                "type": "number"
            }
        ]
    },
    {
        "id": "k8sPersistentVolume",
        "name": "Persistent Volume",
        "category": "Kubernetes",
        "color": "#0277bd",
        "shape": "cylinder",
        "icon": "💾",
        "properties": [
            {
                "key": "capacity",
                "label": "Capacity",
                "type": "string"
            },
            {
                "key": "accessMode",
                "label": "Access mode",
                "type": "string"
            },
            {
                "key": "reclaimPolicy",
                "label": "Reclaim policy",
                "type": "string"
            },
            {
                "key": "storageClass",
                "label": "Storage class",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sPersistentVolumeClaim",
        "name": "Persistent Volume Claim",
        "category": "Kubernetes",
        "color": "#0288d1",
        "shape": "cylinder",
        "icon": "🗄️",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "request",
                "label": "Requested size",
                "type": "string"
            },
            {
                "key": "accessMode",
                "label": "Access mode",
                "type": "string"
            },
            {
                "key": "status",
                "label": "Status",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sServiceAccount",
        "name": "Service Account",
        "category": "Kubernetes",
        "color": "#8d6e63",
        "shape": "circle",
        "icon": "🤖",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "name",
                "label": "Name",
                "type": "string"
            },
            {
                "key": "automountToken",
                "label": "Automount token (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sHelmRelease",
        "name": "Helm Release",
        "category": "Kubernetes",
        "color": "#0f1689",
        "shape": "rounded",
        "icon": "☸️",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "chart",
                "label": "Chart",
                "type": "string"
            },
            {
                "key": "chartVersion",
                "label": "Chart version",
                "type": "string"
            },
            {
                "key": "revision",
                "label": "Revision",
                "type": "number"
            }
        ]
    },
    {
        "id": "k8sContainer",
        "name": "Container",
        "category": "Kubernetes",
        "color": "#1565c0",
        "shape": "rect",
        "icon": "📦",
        "properties": [
            {
                "key": "image",
                "label": "Image",
                "type": "string"
            },
            {
                "key": "ports",
                "label": "Container ports",
                "type": "string"
            },
            {
                "key": "cpuRequest",
                "label": "CPU request",
                "type": "string"
            },
            {
                "key": "memRequest",
                "label": "Memory request",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sSidecar",
        "name": "Sidecar Container",
        "category": "Kubernetes",
        "color": "#5c6bc0",
        "shape": "rect",
        "icon": "🛵",
        "properties": [
            {
                "key": "image",
                "label": "Image",
                "type": "string"
            },
            {
                "key": "purpose",
                "label": "Purpose (proxy/log/init)",
                "type": "string"
            },
            {
                "key": "ports",
                "label": "Ports",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sHpa",
        "name": "Horizontal Pod Autoscaler",
        "category": "Kubernetes",
        "color": "#ef6c00",
        "shape": "diamond",
        "icon": "📈",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "target",
                "label": "Scale target",
                "type": "string"
            },
            {
                "key": "minReplicas",
                "label": "Min replicas",
                "type": "number"
            },
            {
                "key": "maxReplicas",
                "label": "Max replicas",
                "type": "number"
            }
        ]
    },
    {
        "id": "k8sNetworkPolicy",
        "name": "Network Policy",
        "category": "Kubernetes",
        "color": "#1e88a8",
        "shape": "diamond",
        "icon": "🚧",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "podSelector",
                "label": "Pod selector",
                "type": "string"
            },
            {
                "key": "policyTypes",
                "label": "Policy types (Ingress/Egress)",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sRole",
        "name": "Role / ClusterRole",
        "category": "Kubernetes",
        "color": "#7e57c2",
        "shape": "rect",
        "icon": "🎭",
        "properties": [
            {
                "key": "scope",
                "label": "Scope (Role/ClusterRole)",
                "type": "string"
            },
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "ruleCount",
                "label": "Rule count",
                "type": "number"
            }
        ]
    },
    {
        "id": "k8sRoleBinding",
        "name": "RoleBinding",
        "category": "Kubernetes",
        "color": "#9575cd",
        "shape": "rect",
        "icon": "🔗",
        "properties": [
            {
                "key": "scope",
                "label": "Scope (Role/ClusterRoleBinding)",
                "type": "string"
            },
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "subject",
                "label": "Subject",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sStorageClass",
        "name": "Storage Class",
        "category": "Kubernetes",
        "color": "#0277bd",
        "shape": "rect",
        "icon": "🏷️",
        "properties": [
            {
                "key": "provisioner",
                "label": "Provisioner",
                "type": "string"
            },
            {
                "key": "reclaimPolicy",
                "label": "Reclaim policy",
                "type": "string"
            },
            {
                "key": "volumeBindingMode",
                "label": "Volume binding mode",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sCrd",
        "name": "Custom Resource (CRD)",
        "category": "Kubernetes",
        "color": "#5e35b1",
        "shape": "rect",
        "icon": "🧬",
        "properties": [
            {
                "key": "group",
                "label": "API group",
                "type": "string"
            },
            {
                "key": "kind",
                "label": "Kind",
                "type": "string"
            },
            {
                "key": "scope",
                "label": "Scope (Namespaced/Cluster)",
                "type": "string"
            },
            {
                "key": "version",
                "label": "Version",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sOperator",
        "name": "Operator / Controller",
        "category": "Kubernetes",
        "color": "#4527a0",
        "shape": "rounded",
        "icon": "🤖",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "manages",
                "label": "Managed CRD",
                "type": "string"
            },
            {
                "key": "image",
                "label": "Image",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sIngressController",
        "name": "Ingress Controller",
        "category": "Kubernetes",
        "color": "#2e7d32",
        "shape": "rounded",
        "icon": "🚦",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "implementation",
                "label": "Implementation (nginx/traefik)",
                "type": "string"
            },
            {
                "key": "loadBalancerIp",
                "label": "LB IP",
                "type": "string"
            }
        ]
    },
    {
        "id": "k8sGateway",
        "name": "Gateway API",
        "category": "Kubernetes",
        "color": "#388e3c",
        "shape": "diamond",
        "icon": "🛂",
        "properties": [
            {
                "key": "namespace",
                "label": "Namespace",
                "type": "string"
            },
            {
                "key": "gatewayClass",
                "label": "GatewayClass",
                "type": "string"
            },
            {
                "key": "listeners",
                "label": "Listeners",
                "type": "number"
            }
        ]
    },
    {
        "id": "iamUser",
        "name": "IAM User",
        "category": "Cloud · Security & IAM",
        "color": "#d4a017",
        "shape": "circle",
        "icon": "👤",
        "properties": [
            {
                "key": "userName",
                "label": "User name",
                "type": "string"
            },
            {
                "key": "arn",
                "label": "ARN",
                "type": "string"
            },
            {
                "key": "mfaEnabled",
                "label": "MFA enabled (yes/no)",
                "type": "string"
            },
            {
                "key": "accessKeys",
                "label": "Active access keys",
                "type": "number"
            }
        ]
    },
    {
        "id": "iamRole",
        "name": "IAM Role",
        "category": "Cloud · Security & IAM",
        "color": "#e0ac2b",
        "shape": "rounded",
        "icon": "🎭",
        "properties": [
            {
                "key": "roleName",
                "label": "Role name",
                "type": "string"
            },
            {
                "key": "arn",
                "label": "ARN",
                "type": "string"
            },
            {
                "key": "trustedPrincipal",
                "label": "Trusted principal",
                "type": "string"
            },
            {
                "key": "maxSessionSec",
                "label": "Max session (sec)",
                "type": "number"
            }
        ]
    },
    {
        "id": "iamPolicy",
        "name": "IAM Policy",
        "category": "Cloud · Security & IAM",
        "color": "#c9941a",
        "shape": "rect",
        "icon": "📜",
        "properties": [
            {
                "key": "policyName",
                "label": "Policy name",
                "type": "string"
            },
            {
                "key": "arn",
                "label": "ARN",
                "type": "string"
            },
            {
                "key": "effect",
                "label": "Effect (Allow/Deny)",
                "type": "string"
            },
            {
                "key": "managed",
                "label": "Managed (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "iamGroup",
        "name": "IAM Group",
        "category": "Cloud · Security & IAM",
        "color": "#b8860b",
        "shape": "rounded",
        "icon": "👥",
        "properties": [
            {
                "key": "groupName",
                "label": "Group name",
                "type": "string"
            },
            {
                "key": "arn",
                "label": "ARN",
                "type": "string"
            },
            {
                "key": "memberCount",
                "label": "Member count",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudServiceAccount",
        "name": "Cloud Service Account",
        "category": "Cloud · Security & IAM",
        "color": "#caa92e",
        "shape": "circle",
        "icon": "🤖",
        "properties": [
            {
                "key": "accountId",
                "label": "Account ID/email",
                "type": "string"
            },
            {
                "key": "provider",
                "label": "Provider (GCP/Azure/AWS)",
                "type": "string"
            },
            {
                "key": "scopes",
                "label": "Scopes",
                "type": "string"
            },
            {
                "key": "keyRotationDays",
                "label": "Key rotation (days)",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudIdentityProvider",
        "name": "Identity Provider (IdP/SSO)",
        "category": "Cloud · Security & IAM",
        "color": "#9c6f0e",
        "shape": "diamond",
        "icon": "🔓",
        "properties": [
            {
                "key": "name",
                "label": "Provider name",
                "type": "string"
            },
            {
                "key": "protocol",
                "label": "Protocol (SAML/OIDC)",
                "type": "string"
            },
            {
                "key": "metadataUrl",
                "label": "Metadata URL",
                "type": "string"
            },
            {
                "key": "domain",
                "label": "Domain",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudUserPool",
        "name": "User Pool (Cognito)",
        "category": "Cloud · Security & IAM",
        "color": "#e8b733",
        "shape": "cylinder",
        "icon": "🗂️",
        "properties": [
            {
                "key": "poolId",
                "label": "Pool ID",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "mfaConfig",
                "label": "MFA config",
                "type": "string"
            },
            {
                "key": "userCount",
                "label": "User count",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudKmsKey",
        "name": "KMS Key",
        "category": "Cloud · Security & IAM",
        "color": "#a23b3b",
        "shape": "rect",
        "icon": "🔑",
        "properties": [
            {
                "key": "keyId",
                "label": "Key ID",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "keySpec",
                "label": "Key spec",
                "type": "string"
            },
            {
                "key": "rotationEnabled",
                "label": "Rotation (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudCertificate",
        "name": "Certificate (ACM)",
        "category": "Cloud · Security & IAM",
        "color": "#b5524f",
        "shape": "rect",
        "icon": "📃",
        "properties": [
            {
                "key": "domainName",
                "label": "Domain name",
                "type": "string"
            },
            {
                "key": "arn",
                "label": "ARN",
                "type": "string"
            },
            {
                "key": "status",
                "label": "Status",
                "type": "string"
            },
            {
                "key": "notAfter",
                "label": "Expires",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudSecret",
        "name": "Secret (Secrets Manager)",
        "category": "Cloud · Security & IAM",
        "color": "#8f2d2d",
        "shape": "cylinder",
        "icon": "🔒",
        "properties": [
            {
                "key": "secretName",
                "label": "Secret name",
                "type": "string"
            },
            {
                "key": "arn",
                "label": "ARN",
                "type": "string"
            },
            {
                "key": "rotationEnabled",
                "label": "Rotation (yes/no)",
                "type": "string"
            },
            {
                "key": "kmsKeyId",
                "label": "KMS key",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudParameter",
        "name": "Parameter (SSM)",
        "category": "Cloud · Security & IAM",
        "color": "#c46a6a",
        "shape": "rect",
        "icon": "🎛️",
        "properties": [
            {
                "key": "name",
                "label": "Parameter name",
                "type": "string"
            },
            {
                "key": "type",
                "label": "Type (String/SecureString)",
                "type": "string"
            },
            {
                "key": "tier",
                "label": "Tier",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudWafRule",
        "name": "WAF Rule",
        "category": "Cloud · Security & IAM",
        "color": "#d97b6b",
        "shape": "diamond",
        "icon": "🛡️",
        "properties": [
            {
                "key": "ruleName",
                "label": "Rule name",
                "type": "string"
            },
            {
                "key": "action",
                "label": "Action (Allow/Block/Count)",
                "type": "string"
            },
            {
                "key": "priority",
                "label": "Priority",
                "type": "number"
            },
            {
                "key": "scope",
                "label": "Scope (CLOUDFRONT/REGIONAL)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudThreatDetector",
        "name": "Threat Detector (GuardDuty)",
        "category": "Cloud · Security & IAM",
        "color": "#9e3b6b",
        "shape": "diamond",
        "icon": "🚨",
        "properties": [
            {
                "key": "detectorId",
                "label": "Detector ID",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "findingFreq",
                "label": "Finding frequency",
                "type": "string"
            },
            {
                "key": "severityFloor",
                "label": "Min severity",
                "type": "number"
            }
        ]
    },
    {
        "id": "iamPermissionBoundary",
        "name": "Permission Boundary / SCP",
        "category": "Cloud · Security & IAM",
        "color": "#a8861a",
        "shape": "rect",
        "icon": "🚧",
        "properties": [
            {
                "key": "name",
                "label": "Name",
                "type": "string"
            },
            {
                "key": "type",
                "label": "Type (Boundary/SCP)",
                "type": "string"
            },
            {
                "key": "effect",
                "label": "Effect",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudResourceVault",
        "name": "Hardware Security Module (HSM)",
        "category": "Cloud · Security & IAM",
        "color": "#7a1f1f",
        "shape": "rect",
        "icon": "🏦",
        "properties": [
            {
                "key": "clusterId",
                "label": "Cluster ID",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "fipsLevel",
                "label": "FIPS level",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudVulnScanner",
        "name": "Vulnerability Scanner (Inspector)",
        "category": "Cloud · Security & IAM",
        "color": "#b8485f",
        "shape": "diamond",
        "icon": "🔬",
        "properties": [
            {
                "key": "scanType",
                "label": "Scan type",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "target",
                "label": "Target resource",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudComplianceConfig",
        "name": "Config / Compliance Rule",
        "category": "Cloud · Security & IAM",
        "color": "#9e6f2e",
        "shape": "diamond",
        "icon": "✅",
        "properties": [
            {
                "key": "ruleName",
                "label": "Rule name",
                "type": "string"
            },
            {
                "key": "resourceType",
                "label": "Resource type",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudSecurityHub",
        "name": "Security Posture Hub",
        "category": "Cloud · Security & IAM",
        "color": "#8f2d4f",
        "shape": "diamond",
        "icon": "🛡️",
        "properties": [
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "standards",
                "label": "Enabled standards",
                "type": "string"
            },
            {
                "key": "findingCount",
                "label": "Finding count",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudPrincipalRoot",
        "name": "Account / Principal Root",
        "category": "Cloud · Security & IAM",
        "color": "#c9941a",
        "shape": "circle",
        "icon": "🏛️",
        "properties": [
            {
                "key": "accountId",
                "label": "Account ID",
                "type": "string"
            },
            {
                "key": "alias",
                "label": "Account alias",
                "type": "string"
            },
            {
                "key": "provider",
                "label": "Provider",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudOrgUnit",
        "name": "Organization / OU",
        "category": "Cloud · Security & IAM",
        "color": "#b8860b",
        "shape": "rounded",
        "icon": "🗄️",
        "properties": [
            {
                "key": "ouName",
                "label": "OU name",
                "type": "string"
            },
            {
                "key": "accountCount",
                "label": "Account count",
                "type": "number"
            },
            {
                "key": "parentOu",
                "label": "Parent OU",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudIacStack",
        "name": "IaC Stack (CloudFormation/Terraform)",
        "category": "DevOps & Delivery",
        "color": "#7c4dff",
        "shape": "rounded",
        "icon": "📐",
        "properties": [
            {
                "key": "tool",
                "label": "Tool (CFN/Terraform/CDK)",
                "type": "string"
            },
            {
                "key": "resourceCount",
                "label": "Resource count",
                "type": "number"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "status",
                "label": "Status",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudResourceGroup",
        "name": "Resource Group / Tag Set",
        "category": "DevOps & Delivery",
        "color": "#9575cd",
        "shape": "rounded",
        "icon": "🏷️",
        "properties": [
            {
                "key": "name",
                "label": "Group name",
                "type": "string"
            },
            {
                "key": "tagQuery",
                "label": "Tag query",
                "type": "string"
            },
            {
                "key": "memberCount",
                "label": "Member count",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudCicdPipeline",
        "name": "CI/CD Pipeline",
        "category": "DevOps & Delivery",
        "color": "#5e35b1",
        "shape": "rounded",
        "icon": "🛤️",
        "properties": [
            {
                "key": "tool",
                "label": "Tool (CodePipeline/GH Actions)",
                "type": "string"
            },
            {
                "key": "stageCount",
                "label": "Stage count",
                "type": "number"
            },
            {
                "key": "trigger",
                "label": "Trigger",
                "type": "string"
            },
            {
                "key": "repo",
                "label": "Source repo",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudBuildJob",
        "name": "Build / Test Job",
        "category": "DevOps & Delivery",
        "color": "#673ab7",
        "shape": "rect",
        "icon": "🔨",
        "properties": [
            {
                "key": "tool",
                "label": "Tool (CodeBuild/Jenkins)",
                "type": "string"
            },
            {
                "key": "buildSpec",
                "label": "Build spec",
                "type": "string"
            },
            {
                "key": "computeType",
                "label": "Compute type",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudArtifactRepo",
        "name": "Artifact Repository",
        "category": "DevOps & Delivery",
        "color": "#4527a0",
        "shape": "cylinder",
        "icon": "📦",
        "properties": [
            {
                "key": "type",
                "label": "Type (npm/maven/pypi)",
                "type": "string"
            },
            {
                "key": "tool",
                "label": "Tool (CodeArtifact/Nexus)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudGitRepo",
        "name": "Source Repository",
        "category": "DevOps & Delivery",
        "color": "#512da8",
        "shape": "cylinder",
        "icon": "🌿",
        "properties": [
            {
                "key": "provider",
                "label": "Provider (GitHub/GitLab)",
                "type": "string"
            },
            {
                "key": "url",
                "label": "Repo URL",
                "type": "string"
            },
            {
                "key": "defaultBranch",
                "label": "Default branch",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudDeploymentEnv",
        "name": "Deployment Environment",
        "category": "DevOps & Delivery",
        "color": "#7e57c2",
        "shape": "rounded",
        "icon": "🌐",
        "properties": [
            {
                "key": "name",
                "label": "Name (dev/stage/prod)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "approvalRequired",
                "label": "Approval required (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudFeatureFlag",
        "name": "Feature Flag",
        "category": "DevOps & Delivery",
        "color": "#8e6fd1",
        "shape": "diamond",
        "icon": "🚩",
        "properties": [
            {
                "key": "key",
                "label": "Flag key",
                "type": "string"
            },
            {
                "key": "tool",
                "label": "Tool (LaunchDarkly/AppConfig)",
                "type": "string"
            },
            {
                "key": "rolloutPct",
                "label": "Rollout %",
                "type": "number"
            },
            {
                "key": "enabled",
                "label": "Enabled (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudConfigStore",
        "name": "Config / App Config Store",
        "category": "DevOps & Delivery",
        "color": "#9c64d4",
        "shape": "cylinder",
        "icon": "⚙️",
        "properties": [
            {
                "key": "tool",
                "label": "Tool (AppConfig/Consul)",
                "type": "string"
            },
            {
                "key": "environment",
                "label": "Environment",
                "type": "string"
            },
            {
                "key": "keyCount",
                "label": "Key count",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudAuditTrail",
        "name": "Audit Trail (CloudTrail)",
        "category": "Observability & Integration",
        "color": "#5b7a99",
        "shape": "cylinder",
        "icon": "🧾",
        "properties": [
            {
                "key": "trailName",
                "label": "Trail name",
                "type": "string"
            },
            {
                "key": "s3Bucket",
                "label": "Destination bucket",
                "type": "string"
            },
            {
                "key": "multiRegion",
                "label": "Multi-region (yes/no)",
                "type": "string"
            },
            {
                "key": "logFileValidation",
                "label": "Log validation (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudLogGroup",
        "name": "Log Group",
        "category": "Observability & Integration",
        "color": "#4f8bc9",
        "shape": "cylinder",
        "icon": "📚",
        "properties": [
            {
                "key": "name",
                "label": "Log group name",
                "type": "string"
            },
            {
                "key": "retentionDays",
                "label": "Retention (days)",
                "type": "number"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "kmsKeyId",
                "label": "KMS key",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudMetricAlarm",
        "name": "Metric / Alarm",
        "category": "Observability & Integration",
        "color": "#76b7b2",
        "shape": "diamond",
        "icon": "⏰",
        "properties": [
            {
                "key": "alarmName",
                "label": "Alarm name",
                "type": "string"
            },
            {
                "key": "metric",
                "label": "Metric",
                "type": "string"
            },
            {
                "key": "threshold",
                "label": "Threshold",
                "type": "number"
            },
            {
                "key": "comparison",
                "label": "Comparison operator",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudDashboard",
        "name": "Dashboard",
        "category": "Observability & Integration",
        "color": "#6aa6c9",
        "shape": "rect",
        "icon": "📊",
        "properties": [
            {
                "key": "name",
                "label": "Dashboard name",
                "type": "string"
            },
            {
                "key": "tool",
                "label": "Tool (CloudWatch/Grafana)",
                "type": "string"
            },
            {
                "key": "widgetCount",
                "label": "Widget count",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudTrace",
        "name": "Trace (X-Ray/OTel)",
        "category": "Observability & Integration",
        "color": "#8ec6d4",
        "shape": "rounded",
        "icon": "🛰️",
        "properties": [
            {
                "key": "traceId",
                "label": "Trace ID",
                "type": "string"
            },
            {
                "key": "service",
                "label": "Service",
                "type": "string"
            },
            {
                "key": "durationMs",
                "label": "Duration (ms)",
                "type": "number"
            },
            {
                "key": "spanCount",
                "label": "Span count",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudSaasService",
        "name": "SaaS / Third-party Service",
        "category": "Observability & Integration",
        "color": "#59a14f",
        "shape": "rounded",
        "icon": "🧩",
        "properties": [
            {
                "key": "name",
                "label": "Service name",
                "type": "string"
            },
            {
                "key": "vendor",
                "label": "Vendor",
                "type": "string"
            },
            {
                "key": "authType",
                "label": "Auth type",
                "type": "string"
            },
            {
                "key": "baseUrl",
                "label": "Base URL",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudExternalApi",
        "name": "External API",
        "category": "Observability & Integration",
        "color": "#73b06a",
        "shape": "rounded",
        "icon": "🔌",
        "properties": [
            {
                "key": "name",
                "label": "API name",
                "type": "string"
            },
            {
                "key": "endpoint",
                "label": "Endpoint URL",
                "type": "string"
            },
            {
                "key": "authType",
                "label": "Auth type",
                "type": "string"
            },
            {
                "key": "rateLimit",
                "label": "Rate limit (req/min)",
                "type": "number"
            }
        ]
    },
    {
        "id": "cloudWebhook",
        "name": "Webhook",
        "category": "Observability & Integration",
        "color": "#8cd17d",
        "shape": "diamond",
        "icon": "🪝",
        "properties": [
            {
                "key": "name",
                "label": "Webhook name",
                "type": "string"
            },
            {
                "key": "targetUrl",
                "label": "Target URL",
                "type": "string"
            },
            {
                "key": "event",
                "label": "Trigger event",
                "type": "string"
            },
            {
                "key": "signed",
                "label": "Signed (yes/no)",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudNotificationChannel",
        "name": "Notification Channel",
        "category": "Observability & Integration",
        "color": "#6aa6c9",
        "shape": "rounded",
        "icon": "🔔",
        "properties": [
            {
                "key": "type",
                "label": "Type (email/Slack/PagerDuty)",
                "type": "string"
            },
            {
                "key": "target",
                "label": "Target",
                "type": "string"
            },
            {
                "key": "severityFilter",
                "label": "Severity filter",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudLogStream",
        "name": "Log Stream / Shipper",
        "category": "Observability & Integration",
        "color": "#4f8bc9",
        "shape": "rounded",
        "icon": "📨",
        "properties": [
            {
                "key": "agent",
                "label": "Agent (Fluentbit/Vector)",
                "type": "string"
            },
            {
                "key": "destination",
                "label": "Destination",
                "type": "string"
            },
            {
                "key": "format",
                "label": "Format",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudSyntheticMonitor",
        "name": "Synthetic Monitor / Canary",
        "category": "Observability & Integration",
        "color": "#5fa8b8",
        "shape": "diamond",
        "icon": "🐤",
        "properties": [
            {
                "key": "name",
                "label": "Name",
                "type": "string"
            },
            {
                "key": "frequency",
                "label": "Frequency",
                "type": "string"
            },
            {
                "key": "endpoint",
                "label": "Endpoint",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudFeatureAnalytics",
        "name": "Analytics / Telemetry Sink",
        "category": "Observability & Integration",
        "color": "#73b06a",
        "shape": "cylinder",
        "icon": "📊",
        "properties": [
            {
                "key": "tool",
                "label": "Tool (Segment/Amplitude)",
                "type": "string"
            },
            {
                "key": "eventTypes",
                "label": "Event types",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudPaymentGateway",
        "name": "Payment Gateway",
        "category": "Observability & Integration",
        "color": "#4f9b6e",
        "shape": "diamond",
        "icon": "💳",
        "properties": [
            {
                "key": "provider",
                "label": "Provider (Stripe/Braintree)",
                "type": "string"
            },
            {
                "key": "mode",
                "label": "Mode (test/live)",
                "type": "string"
            },
            {
                "key": "currency",
                "label": "Currency",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudEmailService",
        "name": "Email / SMS Service",
        "category": "Observability & Integration",
        "color": "#69a85f",
        "shape": "rounded",
        "icon": "📧",
        "properties": [
            {
                "key": "provider",
                "label": "Provider (SES/SendGrid/Twilio)",
                "type": "string"
            },
            {
                "key": "channel",
                "label": "Channel (email/SMS)",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            }
        ]
    },
    {
        "id": "cloudLlmEndpoint",
        "name": "LLM / AI Model Endpoint",
        "category": "Observability & Integration",
        "color": "#5b8f6a",
        "shape": "rounded",
        "icon": "🧠",
        "properties": [
            {
                "key": "provider",
                "label": "Provider (Bedrock/OpenAI/Anthropic)",
                "type": "string"
            },
            {
                "key": "model",
                "label": "Model",
                "type": "string"
            },
            {
                "key": "region",
                "label": "Region",
                "type": "string"
            },
            {
                "key": "maxTokens",
                "label": "Max tokens",
                "type": "number"
            }
        ]
    },
    {
        "id": "malware",
        "name": "Malware",
        "category": "Threat",
        "color": "#e15759",
        "shape": "diamond",
        "icon": "☣️",
        "properties": [
            {
                "key": "family",
                "label": "Family",
                "type": "string"
            }
        ]
    },
    {
        "id": "threatActor",
        "name": "Threat Actor",
        "category": "Threat",
        "color": "#b07aa1",
        "shape": "diamond",
        "icon": "🎭",
        "properties": [
            {
                "key": "aliases",
                "label": "Aliases",
                "type": "string"
            }
        ]
    },
    {
        "id": "rect",
        "name": "Rectangle",
        "category": "Shapes",
        "color": "#4f8bc9",
        "shape": "rect",
        "icon": "",
        "properties": []
    },
    {
        "id": "rounded",
        "name": "Rounded",
        "category": "Shapes",
        "color": "#57a6a6",
        "shape": "rounded",
        "icon": "",
        "properties": []
    },
    {
        "id": "diamond",
        "name": "Diamond",
        "category": "Shapes",
        "color": "#8b6bd6",
        "shape": "diamond",
        "icon": "",
        "properties": []
    },
    {
        "id": "cylinder",
        "name": "Cylinder",
        "category": "Shapes",
        "color": "#5cab7d",
        "shape": "cylinder",
        "icon": "",
        "properties": []
    },
    {
        "id": "swimlane",
        "name": "Swimlane",
        "category": "Shapes",
        "color": "#f2c94c",
        "shape": "swimlane",
        "icon": "",
        "properties": []
    }
];

    // Palette grouping order.
    const CATEGORY_ORDER = ["General", "Identity", "Network", "Infrastructure", "Geo", "UML · Structural", "UML · Behavioral", "Data Flow", "Cloud · Compute", "Cloud · Storage & Data", "Cloud · Network", "Kubernetes", "Cloud · Security & IAM", "DevOps & Delivery", "Observability & Integration", "Threat", "Shapes"];

    const _orderIndex = {};
    CATEGORY_ORDER.forEach((c, i) => { _orderIndex[c] = i; });
    TYPE_LIST.sort((a, b) => {
        const ai = _orderIndex[a.category] != null ? _orderIndex[a.category] : 999;
        const bi = _orderIndex[b.category] != null ? _orderIndex[b.category] : 999;
        return ai - bi;
    });

    const ENTITY_TYPES = {};
    TYPE_LIST.forEach(t => {
        ENTITY_TYPES[t.id] = {
            id: t.id,
            name: t.name,
            category: t.category,
            color: t.color,
            shape: t.shape,
            icon: t.icon || "",
            valuePattern: t.valuePattern,
            properties: Array.isArray(t.properties) ? t.properties : []
        };
    });

    function getEntityType(id) {
        if (!id) return null;
        return ENTITY_TYPES[id] || null;
    }
    function listEntityTypes() {
        return Object.values(ENTITY_TYPES);
    }
    function listEntityCategories() {
        const cats = {};
        Object.values(ENTITY_TYPES).forEach(t => {
            (cats[t.category] = cats[t.category] || []).push(t);
        });
        return cats;
    }
    // Returns null when valid, or an error string when the value violates the
    // type's pattern. Empty values are always allowed (advisory validation only).
    function validateEntityValue(typeId, value) {
        const t = getEntityType(typeId);
        if (!t || !t.valuePattern || !value) return null;
        try {
            const re = new RegExp(t.valuePattern, "i");
            return re.test(String(value)) ? null : (t.name + " value looks invalid");
        } catch (e) { return null; }
    }

    const EntityRegistry = { ENTITY_TYPES, CATEGORY_ORDER, getEntityType, listEntityTypes, listEntityCategories, validateEntityValue };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = EntityRegistry;
    } else {
        global.EntityRegistry = EntityRegistry;
        global.getEntityType = getEntityType;
        global.listEntityTypes = listEntityTypes;
        global.listEntityCategories = listEntityCategories;
        global.validateEntityValue = validateEntityValue;
    }
})(typeof window !== "undefined" ? window : this);
