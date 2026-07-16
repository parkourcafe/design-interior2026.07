\set ON_ERROR_STOP on

do $assert$
declare
  canonical_a jsonb := jsonb_build_object(
    chr(65536),
    jsonb_build_object('z', 1, 'a', 2),
    chr(57344),
    jsonb_build_array('second', 'first')
  );
  canonical_b jsonb := jsonb_build_object(
    chr(57344),
    jsonb_build_array('second', 'first'),
    chr(65536),
    jsonb_build_object('a', 2, 'z', 1)
  );
  expected_canonical text :=
    '{'
    || to_jsonb(chr(57344))::text
    || ':["second","first"],'
    || to_jsonb(chr(65536))::text
    || ':{"a":2,"z":1}}';
  number_boundaries jsonb :=
    '[
      1e-7,
      1e-6,
      1e20,
      1e21,
      -1e-7,
      -1e-6,
      -1e20,
      -1e21,
      -0,
      9007199254740991,
      9007199254740992,
      9007199254740993,
      0.30000000000000004,
      1.2345678901234567
    ]'::jsonb;
  expected_numbers text :=
    '[1e-7,0.000001,100000000000000000000,1e+21,'
    || '-1e-7,-0.000001,-100000000000000000000,-1e+21,'
    || '0,9007199254740991,9007199254740992,9007199254740992,'
    || '0.30000000000000004,1.2345678901234567]';
  actual text;
begin
  actual := project_intelligence._canonical_jsonb(canonical_a);
  if actual is distinct from expected_canonical then
    raise exception
      'DB2_CANONICAL_OBJECT_A_MISMATCH expected=% actual=%',
      expected_canonical,
      actual;
  end if;

  actual := project_intelligence._canonical_jsonb(canonical_b);
  if actual is distinct from expected_canonical then
    raise exception
      'DB2_CANONICAL_OBJECT_B_MISMATCH expected=% actual=%',
      expected_canonical,
      actual;
  end if;

  if project_intelligence._sha256_jsonb(canonical_a)
       is distinct from project_intelligence._sha256_jsonb(canonical_b) then
    raise exception 'DB2_CANONICAL_EQUAL_OBJECT_HASH_MISMATCH';
  end if;

  if encode(
    project_intelligence._sha256_jsonb(canonical_a),
    'hex'
  ) <> 'c640ff9f43f70091e12c4b41dcd0e6d077afcbc99986eb0c90c1616ba8728edd' then
    raise exception 'DB2_CANONICAL_OBJECT_EXTERNAL_HASH_MISMATCH';
  end if;

  actual := project_intelligence._canonical_jsonb(number_boundaries);
  if actual is distinct from expected_numbers then
    raise exception
      'DB2_CANONICAL_NUMBER_BOUNDARY_MISMATCH expected=% actual=%',
      expected_numbers,
      actual;
  end if;

  if encode(
    project_intelligence._sha256_jsonb(number_boundaries),
    'hex'
  ) <> 'dbbee69ab9fefa1082b117642a282032a2fb6c2d501c8b50c0db5980453485a1' then
    raise exception 'DB2_CANONICAL_NUMBER_EXTERNAL_HASH_MISMATCH';
  end if;

  if encode(
    project_intelligence._sha256_jsonb(
      jsonb_build_array('a' || chr(31) || 'b', 'c')
    ),
    'hex'
  ) <> '46b7bd7f1b3e20eea7d56150414525a363f7ca5f055099f51cc3fdff214f821b'
     or encode(
       project_intelligence._sha256_jsonb(
         jsonb_build_array('a', 'b' || chr(31) || 'c')
       ),
       'hex'
     ) <> 'ed55ec0d48f6b2de7872378f1f72ddf22cd6b4c6c4857339810c4b44296887c6'
     or project_intelligence._sha256_jsonb(
       jsonb_build_array('a' || chr(31) || 'b', 'c')
     ) = project_intelligence._sha256_jsonb(
       jsonb_build_array('a', 'b' || chr(31) || 'c')
     ) then
    raise exception 'DB2_CANONICAL_DELIMITER_COLLISION';
  end if;

  begin
    perform project_intelligence._canonical_jsonb('1e10000'::jsonb);
    raise exception 'DB2_CANONICAL_OUT_OF_RANGE_NUMBER_ACCEPTED';
  exception
    when sqlstate 'P1011' then
      if sqlerrm <> 'DOMAIN_CONTRACT_VIOLATION' then
        raise;
      end if;
  end;
end
$assert$;

select 'DB2_CANONICAL_JSON_ASSERTIONS_OK' as result;
