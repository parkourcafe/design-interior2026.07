\set ON_ERROR_STOP on

-- Contract v0.2 boundary. The publish validator accepts both declared
-- versions, each by its own rules; a document wearing the wrong version's
-- shape is refused, not "almost accepted".

do $layout_v02$
declare
  v_base jsonb;
  v_v01 jsonb;
  v_v02 jsonb;
begin
  -- Старая форма 0.1: hemisphere-свет, прямоугольная зона, label опционален.
  v_v01 := jsonb_build_object(
    'contractVersion', 'archidom.layout-document/0.1',
    'documentId', 'layout.v01', 'projectId', 'project.v01', 'name', 'V01',
    'canonicalUnits', 'mm', 'stateRevision', 1,
    'floor', jsonb_build_object('id','floor.1','label','Этаж','elevationMm',0,'clearHeightMm',2700),
    'variant', jsonb_build_object('id','variant.1','label','База','status','published'),
    'nodes', jsonb_build_array(
      jsonb_build_object('id','node.a','xMm',0,'yMm',0,'locked',false),
      jsonb_build_object('id','node.b','xMm',4000,'yMm',0,'locked',false)),
    'walls', jsonb_build_array(jsonb_build_object(
      'id','wall.ab','startNodeId','node.a','endNodeId','node.b',
      'thicknessMm',200,'heightMm',2700,'kind','bearing','locked',false)),
    'openings', '[]'::jsonb, 'columns', '[]'::jsonb, 'objects', '[]'::jsonb,
    'clearanceZones', jsonb_build_array(jsonb_build_object(
      'id','zone.old','xMm',100,'yMm',100,'widthMm',900,'depthMm',900,'rotationDeg',0)),
    'materials', '[]'::jsonb, 'materialAssignments', '[]'::jsonb,
    'lights', jsonb_build_array(jsonb_build_object(
      'id','light.hemi','kind','hemisphere','xMm',0,'yMm',0,'zMm',2500,
      'color','#ffffff','groundColor','#333333','intensity',1,'label','Небо')),
    'metadata', jsonb_build_object('sourceRefs','[]'::jsonb,'warnings','[]'::jsonb)
  );
  if not projectceo_product._m2_validate_layout_document(v_v01) then
    raise exception 'DB4_LAYOUT_V01_SHAPE_REJECTED';
  end if;

  -- Новая форма 0.2: linear_proxy, полигональная зона, catalogKey, label везде.
  v_v02 := v_v01;
  v_v02 := jsonb_set(v_v02, '{contractVersion}', '"archidom.layout-document/0.2"');
  v_v02 := jsonb_set(v_v02, '{documentId}', '"layout.v02"');
  v_v02 := jsonb_set(v_v02, '{walls,0,label}', '"Несущая"');
  v_v02 := jsonb_set(v_v02, '{objects}', jsonb_build_array(jsonb_build_object(
    'id','object.desk','kind','worktop','xMm',500,'yMm',500,'zMm',0,
    'widthMm',1200,'depthMm',600,'heightMm',900,'rotationDeg',0,'locked',false,
    'label','Столешница','catalogKey','cat:desk-01')));
  v_v02 := jsonb_set(v_v02, '{clearanceZones}', jsonb_build_array(jsonb_build_object(
    'id','zone.walk','label','Проход','severity','warning',
    'relatedObjectIds', jsonb_build_array('object.desk'),
    'polygon', jsonb_build_array(
      jsonb_build_object('xMm',0,'yMm',0),
      jsonb_build_object('xMm',1000,'yMm',0),
      jsonb_build_object('xMm',1000,'yMm',1000)))));
  v_v02 := jsonb_set(v_v02, '{lights}', jsonb_build_array(jsonb_build_object(
    'id','light.line','kind','linear_proxy','xMm',0,'yMm',0,'zMm',2500,
    'color','#ffffff','intensity',1,'label','Линия')));
  if not projectceo_product._m2_validate_layout_document(v_v02) then
    raise exception 'DB4_LAYOUT_V02_SHAPE_REJECTED';
  end if;

  -- Форма не своей версии — отказ в обе стороны.
  if projectceo_product._m2_validate_layout_document(
       jsonb_set(v_v02, '{contractVersion}', '"archidom.layout-document/0.1"')) then
    raise exception 'DB4_LAYOUT_V02_SHAPE_ACCEPTED_AS_V01';
  end if;
  if projectceo_product._m2_validate_layout_document(
       jsonb_set(v_v01, '{contractVersion}', '"archidom.layout-document/0.2"')) then
    raise exception 'DB4_LAYOUT_V01_SHAPE_ACCEPTED_AS_V02';
  end if;
  -- Неизвестная версия не читается сегодняшними правилами.
  if projectceo_product._m2_validate_layout_document(
       jsonb_set(v_v01, '{contractVersion}', '"archidom.layout-document/9.9"')) then
    raise exception 'DB4_LAYOUT_UNKNOWN_VERSION_ACCEPTED';
  end if;
end
$layout_v02$;

select 'DB4_M2_LAYOUT_DOCUMENT_V02_OK' result;
