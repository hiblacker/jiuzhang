package cn.jiuzhang.platform;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import org.junit.jupiter.api.Test;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

class ArchitectureTest {
    @Test void domainHasNoFrameworkOrInfrastructureDependencies() {
        var classes = new ClassFileImporter().importPackages("cn.jiuzhang.platform");
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework..", "java.sql..",
                "com.fasterxml.jackson..", "..infrastructure..", "..api..", "..worker..")
            .allowEmptyShould(true).check(classes);
        noClasses().that().resideInAPackage("cn.jiuzhang.platform..")
            .should().dependOnClassesThat().resideInAnyPackage("cn.jiuzhang.api..", "cn.jiuzhang.worker..")
            .check(classes);
    }
}
