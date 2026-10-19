package cn.jiuzhang.platform.warehouse.domain;
import java.util.*;
/** Deliberately bounded initial query language; SQL is reconstructed from verified identifiers. */
public record ReadQuery(String table,List<String> columns,int limit,int offset){
 public ReadQuery{columns=List.copyOf(columns);}
}
