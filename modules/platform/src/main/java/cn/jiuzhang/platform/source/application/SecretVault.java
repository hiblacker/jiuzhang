package cn.jiuzhang.platform.source.application;

public interface SecretVault {
    String seal(String reference,String secret);
    String open(String reference,String ciphertext);
}
