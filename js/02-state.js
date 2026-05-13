// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
let currentSession=null, currentUser=null, currentOrg=null, currentRole=null;
let xliffSegs=[],xliffRawXml='',xliffXmlDoc=null;
let pptxSegs=[],pptxZip=null,pptxFilename='';
let quickMode=null;
let dictCache=[],tmCache=[],histCache=[];
let tmApiSaved=0;
const domParser=new DOMParser(),xmlSer=new XMLSerializer();
const XLIFF_NS='urn:oasis:names:tc:xliff:document:1.2';
const PRICE_IN=3.0,PRICE_OUT=15.0,PLN_USD=4.0,CPT=4,CHUNK=20;

// project system state
let projectsCache = [];
let currentProject = null;
let currentProjectLang = null;
let currentProjectSegs = [];
let currentAssignments = [];
let autosaveTimers = {};
let npFile = null;
let npLangRows = [];
let teamMembersCache = [];
let editingProjectId = null;

// subtitles state
let subtitleSegs=[];
let subtitleFormat='srt';
let subtitleFilename='';

// notifications state
let notificationsCache = [];

// dashboard state
let projFilterMode = 'active';