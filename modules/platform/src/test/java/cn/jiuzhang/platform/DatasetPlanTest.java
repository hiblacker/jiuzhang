package cn.jiuzhang.platform;
import cn.jiuzhang.platform.dataset.domain.DatasetPlan;
import cn.jiuzhang.platform.dataset.domain.DatasetPlan.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
class DatasetPlanTest {
 private DatasetPlan plan(String type){return new DatasetPlan(List.of(new Field("amount","amount",type,true,true,"")),List.of(),false,List.of(),List.of());}
 @Test void preservesExactIntegersDecimalsNullAndZero(){assertThat(plan("integer").transform(Map.of("amount","9007199254740993"))).containsEntry("amount","9007199254740993");assertThat(plan("decimal(20,4)").transform(Map.of("amount","12345.6700"))).containsEntry("amount","12345.6700");assertThat(plan("decimal(20,4)").transform(Map.of("amount","0.0000"))).containsEntry("amount","0.0000");var row=new HashMap<String,Object>();row.put("amount",null);assertThat(plan("decimal").transform(row)).containsEntry("amount",null);}
 @Test void refusesPrecisionLossAndInvalidValues(){assertThatThrownBy(()->plan("decimal(4,2)").transform(Map.of("amount","1.001"))).isInstanceOf(Problem.class);assertThatThrownBy(()->plan("integer").transform(Map.of("amount","1.5"))).isInstanceOf(Problem.class);assertThatThrownBy(()->plan("decimal(4,2)").transform(Map.of("amount","100.00"))).isInstanceOf(Problem.class);}
 @Test void evaluatesBeforeMaskAndNeverExposesShortStrings(){var q=new QualityRule("1",1,"required","phone","","BLOCK",true);var p=new DatasetPlan(List.of(new Field("phone","phone","string",true,true,"2")),List.of(new Filter("city","杭州")),true,List.of(q),List.of(new Mask("2",1,3,4,true)));var converted=p.transform(Map.of("phone"," 13800138000 ","city","杭州"));assertThat(p.passes(q,converted)).isTrue();assertThat(p.output(converted)).containsEntry("phone","138****8000");assertThat(p.transform(Map.of("city","上海"))).isNull();assertThat(DatasetPlan.mask("abc",3,4)).isEqualTo("***");}
 @Test void rejectsBadMappings(){assertThatThrownBy(()->new DatasetPlan(List.of(new Field("a","same","string",true,true,""),new Field("b","SAME","string",true,true,"")),List.of(),false,List.of(),List.of())).isInstanceOf(Problem.class);}
}
