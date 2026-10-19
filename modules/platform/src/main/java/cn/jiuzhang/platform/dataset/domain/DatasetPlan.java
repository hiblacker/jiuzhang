package cn.jiuzhang.platform.dataset.domain;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.LocalDate;
import java.util.*;
/** Executable immutable rules; independent of HTTP, JSON, JDBC and frameworks. */
public record DatasetPlan(List<Field> fields,List<Filter> filters,boolean trim,List<QualityRule> quality,List<Mask> masking){
 public record Field(String source,String target,String type,boolean nullable,boolean output,String maskId){}
 public record Filter(String field,String value){}
 public record QualityRule(String id,int version,String kind,String field,String parameter,String severity,boolean enabled){}
 public record Mask(String id,int version,int prefix,int suffix,boolean enabled){}
 public static class Problem extends RuntimeException{public final String code;public Problem(String code){super(code);this.code=code;}}
 public DatasetPlan{
  fields=List.copyOf(fields);filters=List.copyOf(filters);quality=List.copyOf(quality);masking=List.copyOf(masking);
  final var maskList=masking;final var fieldList=fields;var targets=new HashSet<String>();
  if(fields.isEmpty()||fields.size()>200||fields.stream().noneMatch(Field::output))throw new Problem("DATASET_FIELDS_REQUIRED");
  for(var f:fields){
   if(!f.source().matches("[a-zA-Z_][a-zA-Z0-9_]{0,63}")||!f.target().matches("[a-zA-Z_][a-zA-Z0-9_]{0,63}")||!targets.add(f.target().toLowerCase(Locale.ROOT)))throw new Problem("DATASET_FIELD_INVALID");
   if(!Set.of("string","integer","decimal","boolean","date").contains(f.type())&&!f.type().matches("decimal\\([1-9][0-9]?,[0-9]{1,2}\\)" ))throw new Problem("DATASET_TYPE_UNSUPPORTED");
   if(f.type().startsWith("decimal(")){var p=f.type().substring(8,f.type().length()-1).split(",");int precision=Integer.parseInt(p[0]),scale=Integer.parseInt(p[1]);if(precision>38||scale>precision)throw new Problem("DATASET_TYPE_UNSUPPORTED");}
   if(!f.maskId().isEmpty()&&(!f.type().equals("string")||maskList.stream().noneMatch(m->m.id().equals(f.maskId())&&m.enabled())))throw new Problem("MASK_POLICY_INVALID");
  }
  for(var q:quality){if(!Set.of("required","range").contains(q.kind())||fieldList.stream().noneMatch(f->f.target().equals(q.field())))throw new Problem("QUALITY_RULE_INVALID");if(q.kind().equals("range"))range(q.parameter());}
 }
 public Set<String> usedSourceFields(){var names=new HashSet<String>();fields.stream().filter(f->f.output()||quality.stream().anyMatch(q->q.field().equals(f.target()))).forEach(f->names.add(f.source()));filters.forEach(f->names.add(f.field()));return Set.copyOf(names);}
 /** Null means filtered out. Invalid input never silently becomes zero. */
 public Map<String,Object> transform(Map<String,Object> row){
  for(var f:filters)if(!Objects.equals(row.get(f.field())==null?null:row.get(f.field()).toString(),f.value()))return null;
  var result=new LinkedHashMap<String,Object>();
  for(var f:fields){if(!f.output()&&quality.stream().noneMatch(q->q.field().equals(f.target())))continue;Object value=row.get(f.source());if(value instanceof String s&&trim)value=s.strip();if(value==null&&!f.nullable())throw new Problem("DATASET_NULL_NOT_ALLOWED");
   try{if(value!=null)value=switch(f.type().startsWith("decimal(")?"decimal":f.type()){
    case "string"->value.toString();case "integer"->new BigInteger(value.toString()).toString();case "decimal"->{var n=new BigDecimal(value.toString());if(f.type().equals("decimal")){n=n.setScale(9,java.math.RoundingMode.UNNECESSARY);if(n.precision()>38)throw new IllegalArgumentException();}if(f.type().startsWith("decimal(")){var parts=f.type().substring(8,f.type().length()-1).split(",");int precision=Integer.parseInt(parts[0]),scale=Integer.parseInt(parts[1]);if(precision>38||scale>precision)throw new IllegalArgumentException();n=n.setScale(scale,java.math.RoundingMode.UNNECESSARY);if(n.precision()>precision)throw new IllegalArgumentException();}yield n.toPlainString();}
    case "boolean"->{if(value.equals(true)||value.toString().equals("1"))yield true;if(value.equals(false)||value.toString().equals("0"))yield false;throw new IllegalArgumentException();}
    case "date"->LocalDate.parse(value.toString()).toString();default->throw new IllegalArgumentException();};
   }catch(Exception e){throw new Problem("DATASET_CONVERSION_FAILED");}result.put(f.target(),value);
  }return result;
 }
 public boolean passes(QualityRule q,Map<String,Object> row){Object value=row.get(q.field());if(q.kind().equals("required"))return value!=null&&!value.toString().isBlank();if(value==null)return false;try{var bounds=range(q.parameter());var n=new BigDecimal(value.toString());return n.compareTo(bounds[0])>=0&&n.compareTo(bounds[1])<=0;}catch(NumberFormatException e){return false;}}
 public Map<String,Object> output(Map<String,Object> row){var result=new LinkedHashMap<String,Object>();for(var f:fields)if(f.output()){Object value=row.get(f.target());if(value!=null&&!f.maskId().isEmpty()){var m=masking.stream().filter(x->x.id().equals(f.maskId())&&x.enabled()).findFirst().orElseThrow(()->new Problem("MASK_POLICY_INVALID"));value=mask(value.toString(),m.prefix(),m.suffix());}result.put(f.target(),value);}return result;}
 public static String mask(String value,int prefix,int suffix){int[] chars=value.codePoints().toArray();if(chars.length<=prefix+suffix)return "*".repeat(chars.length);return new String(chars,0,prefix)+"*".repeat(chars.length-prefix-suffix)+new String(chars,chars.length-suffix,suffix);}
 public static BigDecimal[] range(String parameter){try{var p=parameter.split(",",-1);if(p.length!=2)throw new IllegalArgumentException();var a=new BigDecimal(p[0].strip());var b=new BigDecimal(p[1].strip());if(a.compareTo(b)>0)throw new IllegalArgumentException();return new BigDecimal[]{a,b};}catch(IllegalArgumentException e){throw new Problem("QUALITY_RANGE_INVALID");}}
}
