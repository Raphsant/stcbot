// ISO 3166-2 subdivision codes → display names, for the countries where
// ClickFunnels stores the region as a code. Other countries keep CF's raw value.

export const REGION_NAMES = {
  ES: {
    A: 'Alicante', AB: 'Albacete', AL: 'Almería', AV: 'Ávila', B: 'Barcelona', BA: 'Badajoz',
    BI: 'Bizkaia', BU: 'Burgos', C: 'A Coruña', CA: 'Cádiz', CC: 'Cáceres', CE: 'Ceuta',
    CO: 'Córdoba', CR: 'Ciudad Real', CS: 'Castellón', CU: 'Cuenca', GC: 'Las Palmas', GI: 'Girona',
    GR: 'Granada', GU: 'Guadalajara', H: 'Huelva', HU: 'Huesca', J: 'Jaén', L: 'Lleida',
    LE: 'León', LO: 'La Rioja', LU: 'Lugo', M: 'Madrid', MA: 'Málaga', ML: 'Melilla',
    MU: 'Murcia', NA: 'Navarra', O: 'Asturias', OR: 'Ourense', P: 'Palencia', PM: 'Illes Balears',
    PO: 'Pontevedra', S: 'Cantabria', SA: 'Salamanca', SE: 'Sevilla', SG: 'Segovia', SO: 'Soria',
    SS: 'Gipuzkoa', T: 'Tarragona', TE: 'Teruel', TF: 'Santa Cruz de Tenerife', TO: 'Toledo',
    V: 'Valencia', VA: 'Valladolid', VI: 'Álava', Z: 'Zaragoza', ZA: 'Zamora',
  },
  US: {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  },
  MX: {
    AGU: 'Aguascalientes', BCN: 'Baja California', BCS: 'Baja California Sur', CAM: 'Campeche',
    CHP: 'Chiapas', CHH: 'Chihuahua', CMX: 'Ciudad de México', DIF: 'Ciudad de México',
    COA: 'Coahuila', COL: 'Colima', DUR: 'Durango', GUA: 'Guanajuato', GRO: 'Guerrero',
    HID: 'Hidalgo', JAL: 'Jalisco', MEX: 'Estado de México', MIC: 'Michoacán', MOR: 'Morelos',
    NAY: 'Nayarit', NLE: 'Nuevo León', OAX: 'Oaxaca', PUE: 'Puebla', QUE: 'Querétaro',
    ROO: 'Quintana Roo', SLP: 'San Luis Potosí', SIN: 'Sinaloa', SON: 'Sonora', TAB: 'Tabasco',
    TAM: 'Tamaulipas', TLA: 'Tlaxcala', VER: 'Veracruz', YUC: 'Yucatán', ZAC: 'Zacatecas',
  },
  AR: {
    A: 'Salta', B: 'Buenos Aires', C: 'Ciudad Autónoma de Buenos Aires', D: 'San Luis',
    E: 'Entre Ríos', F: 'La Rioja', G: 'Santiago del Estero', H: 'Chaco', J: 'San Juan',
    K: 'Catamarca', L: 'La Pampa', M: 'Mendoza', N: 'Misiones', P: 'Formosa', Q: 'Neuquén',
    R: 'Río Negro', S: 'Santa Fe', T: 'Tucumán', U: 'Chubut', V: 'Tierra del Fuego',
    W: 'Corrientes', X: 'Córdoba', Y: 'Jujuy', Z: 'Santa Cruz',
  },
  CO: {
    AMA: 'Amazonas', ANT: 'Antioquia', ARA: 'Arauca', ATL: 'Atlántico', BOL: 'Bolívar',
    BOY: 'Boyacá', CAL: 'Caldas', CAQ: 'Caquetá', CAS: 'Casanare', CAU: 'Cauca', CES: 'Cesar',
    CHO: 'Chocó', COR: 'Córdoba', CUN: 'Cundinamarca', DC: 'Bogotá', GUA: 'Guainía',
    GUV: 'Guaviare', HUI: 'Huila', LAG: 'La Guajira', MAG: 'Magdalena', MET: 'Meta',
    NAR: 'Nariño', NSA: 'Norte de Santander', PUT: 'Putumayo', QUI: 'Quindío', RIS: 'Risaralda',
    SAN: 'Santander', SAP: 'San Andrés', SUC: 'Sucre', TOL: 'Tolima', VAC: 'Valle del Cauca',
    VAU: 'Vaupés', VID: 'Vichada',
  },
  CL: {
    AI: 'Aysén', AN: 'Antofagasta', AP: 'Arica y Parinacota', AR: 'Araucanía', AT: 'Atacama',
    BI: 'Biobío', CO: 'Coquimbo', LI: "O'Higgins", LL: 'Los Lagos', LR: 'Los Ríos',
    MA: 'Magallanes', ML: 'Maule', NB: 'Ñuble', RM: 'Región Metropolitana', TA: 'Tarapacá',
    VS: 'Valparaíso',
  },
  PE: {
    AMA: 'Amazonas', ANC: 'Áncash', APU: 'Apurímac', ARE: 'Arequipa', AYA: 'Ayacucho',
    CAJ: 'Cajamarca', CAL: 'Callao', CUS: 'Cusco', HUC: 'Huánuco', HUV: 'Huancavelica',
    ICA: 'Ica', JUN: 'Junín', LAL: 'La Libertad', LAM: 'Lambayeque', LIM: 'Lima',
    LMA: 'Lima Metropolitana', LOR: 'Loreto', MDD: 'Madre de Dios', MOQ: 'Moquegua',
    PAS: 'Pasco', PIU: 'Piura', PUN: 'Puno', SAM: 'San Martín', TAC: 'Tacna', TUM: 'Tumbes',
    UCA: 'Ucayali',
  },
};

// Common non-ISO spellings → ISO code, matched after normalization.
export const REGION_ALIASES = {
  AR: { caba: 'C', 'capital federal': 'C' },
  MX: { cdmx: 'CMX', df: 'CMX', 'distrito federal': 'CMX', 'mexico city': 'CMX' },
  ES: { 'baleares': 'PM', 'islas baleares': 'PM', 'vizcaya': 'BI', 'guipuzcoa': 'SS', 'la coruna': 'C', 'coruna': 'C' },
};
