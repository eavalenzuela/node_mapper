// entities.js — typed-entity registry (the Maltego-style ontology).
// Pure data + lookup helpers, no app state. Loaded BEFORE app.js so the
// editor (normalizeNode, createNodeAt, the palette, the property editor and the
// renderer) can drive everything from entity types instead of bare geometry.
(function (global) {
    "use strict";

    // Each entity type declares: id, display name, category, default color and
    // base geometric shape, a glyph icon, the primary value field, an optional
    // validation regex for that value, and a typed property schema.
    const ENTITY_TYPES = {
        // --- General ---
        generic:      { id: "generic",      name: "Entity",        category: "General",        color: "#4682b4", shape: "circle",   icon: "" ,
                        properties: [] },

        // --- Identity ---
        person:       { id: "person",       name: "Person",        category: "Identity",       color: "#e15759", shape: "circle",   icon: "👤",
                        properties: [{ key: "fullname", label: "Full name", type: "string" }, { key: "email", label: "Email", type: "string" }, { key: "role", label: "Role", type: "string" }] },
        email:        { id: "email",        name: "Email Address", category: "Identity",       color: "#f28e2b", shape: "circle",   icon: "✉️", valuePattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
                        properties: [{ key: "displayName", label: "Display name", type: "string" }] },
        organization: { id: "organization", name: "Organization",  category: "Identity",       color: "#b07aa1", shape: "rounded",  icon: "🏢",
                        properties: [{ key: "domain", label: "Domain", type: "string" }, { key: "country", label: "Country", type: "string" }] },
        phone:        { id: "phone",        name: "Phone Number",  category: "Identity",       color: "#9c755f", shape: "circle",   icon: "📞",
                        properties: [{ key: "country", label: "Country", type: "string" }] },

        // --- Network ---
        domain:       { id: "domain",       name: "Domain",        category: "Network",        color: "#59a14f", shape: "circle",   icon: "🌐", valuePattern: "^([a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,}$",
                        properties: [{ key: "registrar", label: "Registrar", type: "string" }] },
        url:          { id: "url",          name: "URL",           category: "Network",        color: "#76b7b2", shape: "rounded",  icon: "🔗", valuePattern: "^https?://",
                        properties: [{ key: "status", label: "HTTP status", type: "number" }] },
        ipv4:         { id: "ipv4",         name: "IPv4 Address",  category: "Network",        color: "#4e79a7", shape: "rect",     icon: "📡", valuePattern: "^(\\d{1,3}\\.){3}\\d{1,3}$",
                        properties: [{ key: "asn", label: "ASN", type: "string" }, { key: "geo", label: "Geo", type: "string" }] },
        port:         { id: "port",         name: "Network Port",  category: "Network",        color: "#8cd17d", shape: "circle",   icon: "🔌",
                        properties: [{ key: "service", label: "Service", type: "string" }, { key: "protocol", label: "Protocol", type: "string" }] },

        // --- Infrastructure ---
        host:         { id: "host",         name: "Host / Server", category: "Infrastructure", color: "#4f8bc9", shape: "cylinder", icon: "🖥️",
                        properties: [{ key: "os", label: "Operating system", type: "string" }, { key: "ip", label: "IP", type: "string" }] },
        device:       { id: "device",       name: "Device",        category: "Infrastructure", color: "#5cab7d", shape: "rect",     icon: "💻",
                        properties: [{ key: "type", label: "Type", type: "string" }] },
        file:         { id: "file",         name: "File / Document",category: "Infrastructure",color: "#edc948", shape: "rect",     icon: "📄",
                        properties: [{ key: "hash", label: "Hash", type: "string" }, { key: "size", label: "Size", type: "string" }] },

        // --- Geo ---
        location:     { id: "location",     name: "Location",      category: "Geo",            color: "#ff9da7", shape: "circle",   icon: "📍",
                        properties: [{ key: "lat", label: "Latitude", type: "number" }, { key: "lng", label: "Longitude", type: "number" }, { key: "address", label: "Address", type: "string" }] },

        // --- Threat ---
        malware:      { id: "malware",      name: "Malware",       category: "Threat",         color: "#e15759", shape: "diamond",  icon: "☣️",
                        properties: [{ key: "family", label: "Family", type: "string" }] },
        threatActor:  { id: "threatActor",  name: "Threat Actor",  category: "Threat",         color: "#b07aa1", shape: "diamond",  icon: "🎭",
                        properties: [{ key: "aliases", label: "Aliases", type: "string" }] },

        // --- Plain shapes (diagramming) ---
        rect:         { id: "rect",         name: "Rectangle",     category: "Shapes",         color: "#4f8bc9", shape: "rect",     icon: "" , properties: [] },
        rounded:      { id: "rounded",      name: "Rounded",       category: "Shapes",         color: "#57a6a6", shape: "rounded",  icon: "" , properties: [] },
        diamond:      { id: "diamond",      name: "Diamond",       category: "Shapes",         color: "#8b6bd6", shape: "diamond",  icon: "" , properties: [] },
        cylinder:     { id: "cylinder",     name: "Cylinder",      category: "Shapes",         color: "#5cab7d", shape: "cylinder", icon: "" , properties: [] },
        swimlane:     { id: "swimlane",     name: "Swimlane",      category: "Shapes",         color: "#f2c94c", shape: "swimlane", icon: "" , properties: [] }
    };

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

    const EntityRegistry = { ENTITY_TYPES, getEntityType, listEntityTypes, listEntityCategories, validateEntityValue };

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
