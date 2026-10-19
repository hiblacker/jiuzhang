package cn.jiuzhang.platform.source.infrastructure;

import cn.jiuzhang.platform.source.application.SecretVault;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

@Component
public class AesSecretVault implements SecretVault {
    private final SecretKeySpec key;
    private final SecureRandom random=new SecureRandom();
    public AesSecretVault() {
        String value=System.getenv("JIUZHANG_MASTER_KEY");
        if(value==null)throw new IllegalStateException("JIUZHANG_MASTER_KEY required");
        byte[] bytes=Base64.getDecoder().decode(value);
        if(bytes.length!=32)throw new IllegalStateException("JIUZHANG_MASTER_KEY must encode 32 bytes");
        key=new SecretKeySpec(bytes,"AES");
    }
    public String seal(String reference,String secret) {
        try {
            byte[] iv=new byte[12];random.nextBytes(iv);
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key,new GCMParameterSpec(128,iv));
            c.updateAAD(reference.getBytes(StandardCharsets.UTF_8));
            byte[] encrypted=c.doFinal(secret.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(ByteBuffer.allocate(iv.length+encrypted.length).put(iv).put(encrypted).array());
        }catch(Exception e){throw new IllegalStateException("Secret encryption failed");}
    }
    public String open(String reference,String ciphertext) {
        try {
            byte[] bytes=Base64.getDecoder().decode(ciphertext);byte[] iv=java.util.Arrays.copyOfRange(bytes,0,12);
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,iv));
            c.updateAAD(reference.getBytes(StandardCharsets.UTF_8));
            return new String(c.doFinal(bytes,12,bytes.length-12),StandardCharsets.UTF_8);
        }catch(Exception e){throw new IllegalStateException("Secret decryption failed; verify configured master key");}
    }
}
