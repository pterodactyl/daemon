Vagrant.configure("2") do |config|
    config.vm.box = "bento/ubuntu-16.04"

    config.vm.synced_folder "./", "/srv/daemon",
        owner: "root", group: "root"

    config.vm.provision :shell, path: ".dev/vagrant/provision.sh"

    config.vm.network :private_network, ip: "192.168.50.3"
    config.vm.network :forwarded_port, guest: 8080, host: 58080
    config.vm.network :forwarded_port, guest: 2022, host: 52022
end
